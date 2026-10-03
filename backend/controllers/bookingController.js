const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { positiveInteger, validateBooking, validateBookingFilters, checkInEligibility } = require('../utils/bookingValidation');

const bookingRoles = new Set(['Admin', 'Manager', 'Receptionist']);
const forbidden = res => res.status(403).json({ error: 'You do not have permission to perform this action.' });
const notFound = res => res.status(404).json({ error: 'Booking not found.' });
const validUser = user => user && ['guest', 'staff'].includes(user.type) && positiveInteger(user.id) !== null;
const canManage = user => validUser(user) && (user.type === 'guest' || bookingRoles.has(user.role));

function conflictResponse(err, res) {
  if (err.sqlState === '45000') {
    res.status(409).json({ error: err.sqlMessage || 'The booking cannot be changed in its current state.' });
    return true;
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code)) {
    res.status(409).json({ error: 'Another booking action is in progress. Please refresh and try again.' });
    return true;
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    res.status(409).json({ error: 'The guest, staff account or room is no longer available. Please refresh and try again.' });
    return true;
  }
  return false;
}

const roomSelect = `SELECT br.*, r.RoomNumber, r.RoomStatus, r.BranchID, bh.Name AS BranchName,
                          rt.Name AS RoomTypeName, rt.Capacity, rt.DailyRate,
                          DATE_FORMAT(br.CheckInDateTime, '%Y-%m-%d') AS CheckInDate,
                          DATE_FORMAT(br.CheckOutDateTime, '%Y-%m-%d') AS CheckOutDate
                   FROM BOOKED_ROOMS br
                   JOIN ROOM r ON r.RoomID = br.RoomID
                   JOIN BRANCH bh ON bh.BranchID = r.BranchID
                   JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID`;

// POST /api/bookings. The stored procedure owns the booking transaction and
// room locks. A preferred payment method does not create a payment or bill.
const makeBooking = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) return forbidden(res);
  const parsed = validateBooking(req.body, req.user);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { guestId, roomId, checkin, checkout, guestCount, paymentMethod } = parsed.value;
  const staffId = req.user.type === 'staff' ? positiveInteger(req.user.id) : null;
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @p_booking_id = NULL');
    await conn.execute('CALL sp_make_booking(?, ?, ?, ?, ?, ?, ?, @p_booking_id)',
      [guestId, staffId, roomId, checkin, checkout, guestCount, paymentMethod]);
    const [[{ '@p_booking_id': bookingId }]] = await conn.query('SELECT @p_booking_id');
    res.status(201).json({ bookingId, status: 'Booked' });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  } finally {
    conn.release();
  }
});

// Ownership and status are checked in the same conditional UPDATE. A concurrent
// check-in or second cancellation cannot pass an earlier, stale status check.
const cancelBooking = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  const ownerCondition = req.user.type === 'guest' ? ' AND GuestID = ?' : '';
  const params = req.user.type === 'guest' ? [id, positiveInteger(req.user.id)] : [id];
  try {
    const [result] = await pool.execute(
      `UPDATE BOOKING SET BookingStatus = 'Cancelled' WHERE BookingID = ?${ownerCondition} AND BookingStatus = 'Booked'`, params);
    if (result.affectedRows === 1) return res.json({ bookingId: id, status: 'Cancelled' });
    const [[booking]] = await pool.execute(
      `SELECT BookingStatus FROM BOOKING WHERE BookingID = ?${ownerCondition}`, params);
    if (!booking) return notFound(res);
    return res.status(409).json({ error: 'Only a Booked reservation can be cancelled.' });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

// Front desk actions are also protected by requireRole in bookingRoutes.
const checkIn = asyncHandler(async (req, res) => {
  if (!validUser(req.user) || req.user.type !== 'staff' || !bookingRoles.has(req.user.role)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  try {
    const [[booking]] = await pool.execute(
      "SELECT BookingStatus, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS ServerToday FROM BOOKING WHERE BookingID = ?", [id]);
    if (!booking) return notFound(res);
    const [rooms] = await pool.execute(`${roomSelect} WHERE br.BookingID = ? ORDER BY br.BookedRoomID`, [id]);
    const eligibility = checkInEligibility(booking, rooms, booking.ServerToday);
    if (!eligibility.allowed) return res.status(409).json({ error: eligibility.reason });
    // The procedure owns its transaction. Its booking lock and room-status
    // trigger recheck state after these reads, including concurrent check-ins.
    await pool.execute('CALL sp_check_in(?)', [id]);
    res.json({ bookingId: id, status: 'Checked-In' });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

const checkOut = asyncHandler(async (req, res) => {
  if (!validUser(req.user) || req.user.type !== 'staff' || !bookingRoles.has(req.user.role)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  try {
    await pool.execute('CALL sp_check_out(?, ?)', [id, positiveInteger(req.user.id)]);
    const [[bill]] = await pool.execute('SELECT * FROM BILL WHERE BookingID = ?', [id]);
    res.json({ bookingId: id, status: 'Checked-Out', bill });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

// Guest ownership is part of the lookup: foreign and nonexistent bookings
// produce the same 404 response, before reading any booked-room information.
const getBooking = asyncHandler(async (req, res) => {
  if (!validUser(req.user)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  const own = req.user.type === 'guest';
  const [[booking]] = await pool.execute(
    `SELECT b.*, g.Name AS GuestName, g.ContactNumber AS GuestContact,
            g.IDNumber AS GuestIDNumber, g.Email AS GuestEmail, s.Name AS StaffName,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS ServerToday
     FROM BOOKING b JOIN GUEST g ON g.GuestID = b.GuestID
     LEFT JOIN STAFF s ON s.StaffID = b.StaffID
     WHERE b.BookingID = ?${own ? ' AND b.GuestID = ?' : ''}`,
    own ? [id, positiveInteger(req.user.id)] : [id]);
  if (!booking) return notFound(res);
  const [rooms] = await pool.execute(`${roomSelect} WHERE br.BookingID = ? ORDER BY br.BookedRoomID`, [id]);
  const { ServerToday, ...details } = booking;
  res.json({ ...details, rooms,
    ...(own ? {} : { checkInEligibility: checkInEligibility(booking, rooms, ServerToday) }) });
});

// Two queries fetch the headers and all their rooms; adding bookings does not
// cause a separate database round trip for each one.
const listBookings = asyncHandler(async (req, res) => {
  if (!validUser(req.user)) return forbidden(res);
  const parsed = validateBookingFilters(req.query, req.user);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bookingId, guestId, status, branchId, guestName, idNumber } = parsed.value;
  const conditions = [];
  const params = [];
  if (req.user.type === 'guest' || guestId !== undefined) {
    conditions.push('b.GuestID = ?');
    params.push(req.user.type === 'guest' ? positiveInteger(req.user.id) : guestId);
  }
  if (bookingId !== undefined) { conditions.push('b.BookingID = ?'); params.push(bookingId); }
  if (status !== undefined) { conditions.push('b.BookingStatus = ?'); params.push(status); }
  if (branchId !== undefined) { conditions.push('r.BranchID = ?'); params.push(branchId); }
  if (guestName !== undefined) { conditions.push('g.Name LIKE ?'); params.push(`%${guestName}%`); }
  if (idNumber !== undefined) { conditions.push('g.IDNumber = ?'); params.push(idNumber); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT DISTINCT b.BookingID, b.BookingStatus, b.BookingDate, b.CreatedDate, b.PreferredPaymentMethod,
            g.GuestID, g.Name AS GuestName, g.IDNumber
     FROM BOOKING b JOIN GUEST g ON g.GuestID = b.GuestID
     LEFT JOIN BOOKED_ROOMS br ON br.BookingID = b.BookingID
     LEFT JOIN ROOM r ON r.RoomID = br.RoomID
     ${where} ORDER BY b.CreatedDate DESC, b.BookingID DESC LIMIT 200`, params);
  if (!rows.length) return res.json([]);
  const ids = rows.map(row => row.BookingID);
  const [rooms] = await pool.execute(
    `${roomSelect} WHERE br.BookingID IN (${ids.map(() => '?').join(', ')}) ORDER BY br.BookingID, br.BookedRoomID`, ids);
  const roomsByBooking = new Map(ids.map(id => [id, []]));
  for (const room of rooms) roomsByBooking.get(room.BookingID)?.push(room);
  res.json(rows.map(row => ({ ...row, rooms: roomsByBooking.get(row.BookingID) })));
});

module.exports = { makeBooking, cancelBooking, checkIn, checkOut, getBooking, listBookings };
