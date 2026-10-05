const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { positiveInteger, validateBooking, validateBookingFilters, checkInEligibility } = require('../utils/bookingValidation');
const { validateRoomSearch } = require('../utils/roomSearchValidation');

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


const MAX_ROOMS = 10;
const httpError = (status, message) => Object.assign(new Error(message), { status });

// POST /api/bookings with rooms: [{ roomId, guestCount }, ...]. All rooms share the
// booking's checkin/checkout. Single-room requests still use sp_make_booking.
async function makeMultiRoomBooking(req, res) {
  const { rooms, ...base } = req.body;
  if (!rooms.length || rooms.length > MAX_ROOMS) {
    return res.status(400).json({ error: `Provide between 1 and ${MAX_ROOMS} rooms.` });
  }
  const stays = [];
  for (const room of rooms) {
    if (!room || typeof room !== 'object' || Array.isArray(room)) {
      return res.status(400).json({ error: 'Each room must include roomId and guestCount.' });
    }
    const parsed = validateBooking({ ...base, roomId: room.roomId, guestCount: room.guestCount }, req.user);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    stays.push(parsed.value);
  }
  if (new Set(stays.map(stay => stay.roomId)).size !== stays.length) {
    return res.status(400).json({ error: 'A room can appear only once per booking.' });
  }
  stays.sort((a, b) => a.roomId - b.roomId);       // same lock order for everyone avoids deadlocks
  const { guestId, paymentMethod } = stays[0];
  const staffId = req.user.type === 'staff' ? positiveInteger(req.user.id) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [header] = await conn.execute(
      'INSERT INTO BOOKING (GuestID, StaffID, PreferredPaymentMethod) VALUES (?, ?, ?)',
      [guestId, staffId, paymentMethod]);
    for (const stay of stays) {
      const [[room]] = await conn.execute(
        `SELECT r.RoomStatus, rt.Capacity FROM ROOM r JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
         WHERE r.RoomID = ? FOR UPDATE OF r`, [stay.roomId]);
      if (!room) throw httpError(404, `Room ${stay.roomId} was not found.`);
      if (room.RoomStatus === 'Maintenance') throw httpError(409, `Room ${stay.roomId} is under maintenance.`);
      if (stay.guestCount > room.Capacity) throw httpError(400, `Room ${stay.roomId} sleeps at most ${room.Capacity}.`);
      // Locking read, as in sp_make_booking: sees stays committed while this request waited for the room lock.
      const [[clash]] = await conn.execute(
        `SELECT br.BookedRoomID FROM BOOKED_ROOMS br
         JOIN BOOKING b ON b.BookingID = br.BookingID
         WHERE br.RoomID = ? AND b.BookingStatus IN ('Booked','Checked-In')
           AND ? < br.CheckOutDateTime AND ? > br.CheckInDateTime
         LIMIT 1 FOR UPDATE`, [stay.roomId, stay.checkin, stay.checkout]);
      if (clash) throw httpError(409, 'Room is already booked for an overlapping period.');
      await conn.execute(
        `INSERT INTO BOOKED_ROOMS (BookingID, RoomID, CheckInDateTime, CheckOutDateTime, GuestCount)
         VALUES (?, ?, ?, ?, ?)`,
        [header.insertId, stay.roomId, stay.checkin, stay.checkout, stay.guestCount]);
    }
    await conn.commit();
    res.status(201).json({ bookingId: header.insertId, status: 'Booked', rooms: stays.length });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (conflictResponse(err, res)) return;
    throw err;
  } finally {
    conn.release();
  }
}

// POST /api/bookings. The stored procedure owns the booking transaction and
// room locks. A preferred payment method does not create a payment or bill.
const makeBooking = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) return forbidden(res);
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'rooms')) {
    if (!Array.isArray(req.body.rooms)) {
      return res.status(400).json({ error: 'rooms must be an array of roomId and guestCount entries.' });
    }
    return makeMultiRoomBooking(req, res);
  }
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
    const [[booking]] = await pool.execute('SELECT BookingStatus FROM BOOKING WHERE BookingID = ?', [id]);
    if (!booking) return notFound(res);
    if (booking.BookingStatus !== 'Checked-In') {
      return res.status(409).json({ error: 'Only a Checked-In reservation can be checked out.' });
    }
    // The procedure owns the transaction and booking lock. It recalculates the
    // bill and checks payment under that lock before changing status or rooms.
    await pool.execute('CALL sp_check_out(?, ?)', [id, positiveInteger(req.user.id)]);
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
  // Checkout has committed. If its bill cannot be read, report that known
  // success and ask the client to refresh; never rerun the procedure.
  let bill;
  try {
    [[bill]] = await pool.execute('SELECT * FROM BILL WHERE BookingID = ?', [id]);
  } catch {
    // The completed checkout remains successful even without its bill response.
  }
  if (!bill) {
    return res.json({ bookingId: id, status: 'Checked-Out', bill: null, refreshRequired: true });
  }
  res.json({ bookingId: id, status: 'Checked-Out', bill });
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

const updateFields = ['bookedRoomId', 'roomId', 'checkin', 'checkout', 'guestCount'];

// PATCH /api/bookings/:id - change room, dates or guest count of one room entry
// on a Booked reservation. sp_update_booked_room and the update trigger enforce
// status, capacity, maintenance and overlap under locks.
const updateBooking = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !updateFields.includes(key))) {
    return res.status(400).json({ error: `Send only ${updateFields.join(', ')}.` });
  }
  const change = {};
  for (const key of ['bookedRoomId', 'roomId', 'guestCount']) {
    change[key] = body[key] === undefined ? null : positiveInteger(body[key]);
    if (body[key] !== undefined && change[key] === null) {
      return res.status(400).json({ error: `${key} must be a positive whole number no greater than 2147483647.` });
    }
  }
  for (const key of ['checkin', 'checkout']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return res.status(400).json({ error: `${key} must be a YYYY-MM-DD date.` });
    }
  }
  const datesChanged = body.checkin !== undefined || body.checkout !== undefined;
  if (!datesChanged && change.roomId === null && change.guestCount === null) {
    return res.status(400).json({ error: 'Provide at least one of roomId, checkin, checkout or guestCount.' });
  }

  const own = req.user.type === 'guest';
  try {
    const [[booking]] = await pool.execute(
      `SELECT BookingID FROM BOOKING WHERE BookingID = ?${own ? ' AND GuestID = ?' : ''}`,
      own ? [id, positiveInteger(req.user.id)] : [id]);
    if (!booking) return notFound(res);

    const [lines] = await pool.execute(
      `SELECT BookedRoomID, DATE_FORMAT(CheckInDateTime, '%Y-%m-%d') AS CheckInDate,
              DATE_FORMAT(CheckOutDateTime, '%Y-%m-%d') AS CheckOutDate
       FROM BOOKED_ROOMS WHERE BookingID = ? ORDER BY BookedRoomID`, [id]);
    if (change.bookedRoomId === null && lines.length !== 1) {
      return res.status(400).json({ error: 'bookedRoomId is required for a booking with several rooms.' });
    }
    const line = change.bookedRoomId === null ? lines[0] : lines.find(l => l.BookedRoomID === change.bookedRoomId);
    if (!line) return res.status(400).json({ error: 'That room entry does not belong to this booking.' });

    let checkin = null;
    let checkout = null;
    if (datesChanged) {          // a single new date is combined with the stored one, then checked as a pair
      const stay = validateRoomSearch(
        { checkin: body.checkin ?? line.CheckInDate, checkout: body.checkout ?? line.CheckOutDate }, new Date());
      if (stay.error) return res.status(400).json({ error: stay.error });
      // Keep omitted fields null: the procedure resolves them from the current
      // row under its booking lock, rather than overwriting a concurrent edit
      // with a value from this earlier read.
      checkin = body.checkin === undefined ? null : stay.value.checkin;
      checkout = body.checkout === undefined ? null : stay.value.checkout;
    }
    await pool.execute('CALL sp_update_booked_room(?, ?, ?, ?, ?, ?)',
      [id, line.BookedRoomID, change.roomId, checkin, checkout, change.guestCount]);
    res.json({ bookingId: id, bookedRoomId: line.BookedRoomID, status: 'Booked', updated: true });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

module.exports = { makeBooking, updateBooking, cancelBooking, checkIn, checkOut, getBooking, listBookings };
