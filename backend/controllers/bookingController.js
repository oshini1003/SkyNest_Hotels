const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/bookings  (Guest self-service OR Front Desk on the guest's behalf)
// body: { guestId, roomId, checkin, checkout, guestCount, paymentMethod }
// staffId comes from the authenticated staff user if a staff member is booking;
// null if the guest booked it themselves online.
const makeBooking = asyncHandler(async (req, res) => {
  const { guestId, roomId, checkin, checkout, guestCount, paymentMethod } = req.body;
  const staffId = req.user.type === 'staff' ? req.user.id : null;
  const effectiveGuestId = req.user.type === 'guest' ? req.user.id : guestId;

  if (!effectiveGuestId || !roomId || !checkin || !checkout || !paymentMethod) {
    return res.status(400).json({ error: 'guestId, roomId, checkin, checkout and paymentMethod are required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.query('SET @p_booking_id = NULL');
    await conn.execute(
      `CALL sp_make_booking(?, ?, ?, ?, ?, ?, ?, @p_booking_id)`,
      [effectiveGuestId, staffId, roomId, checkin, checkout, guestCount || 1, paymentMethod]
    );
    const [[{ '@p_booking_id': bookingId }]] = await conn.query('SELECT @p_booking_id');
    res.status(201).json({ bookingId, status: 'Booked' });
  } catch (err) {
    if (err.sqlState === '45000') {
      return res.status(409).json({ error: err.sqlMessage });
    }
    throw err;
  } finally {
    conn.release();
  }
});

// PATCH /api/bookings/:id/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [[booking]] = await pool.execute(`SELECT BookingStatus FROM BOOKING WHERE BookingID = ?`, [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.BookingStatus !== 'Booked') {
    return res.status(409).json({ error: 'Only a Booked reservation can be cancelled.' });
  }
  await pool.execute(`UPDATE BOOKING SET BookingStatus = 'Cancelled' WHERE BookingID = ?`, [id]);
  res.json({ bookingId: id, status: 'Cancelled' });
});

// POST /api/bookings/:id/check-in   (Front Desk only)
const checkIn = asyncHandler(async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute(`CALL sp_check_in(?)`, [id]);
    res.json({ bookingId: id, status: 'Checked-In' });
  } catch (err) {
    if (err.sqlState === '45000') return res.status(409).json({ error: err.sqlMessage });
    throw err;
  }
});

// POST /api/bookings/:id/check-out  (Front Desk only)
const checkOut = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const staffId = req.user.id;
  try {
    await pool.execute(`CALL sp_check_out(?, ?)`, [id, staffId]);
    const [[bill]] = await pool.execute(`SELECT * FROM BILL WHERE BookingID = ?`, [id]);
    res.json({ bookingId: id, status: 'Checked-Out', bill });
  } catch (err) {
    if (err.sqlState === '45000') return res.status(409).json({ error: err.sqlMessage });
    throw err;
  }
});

// GET /api/bookings/:id  - full booking detail (rooms, guest, staff, status)
const getBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [[booking]] = await pool.execute(
    `SELECT b.*, g.Name AS GuestName, g.ContactNumber AS GuestContact, s.Name AS StaffName
     FROM BOOKING b
     JOIN GUEST g ON g.GuestID = b.GuestID
     LEFT JOIN STAFF s ON s.StaffID = b.StaffID
     WHERE b.BookingID = ?`,
    [id]
  );
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const [rooms] = await pool.execute(
    `SELECT br.*, r.RoomNumber, r.BranchID, bh.Name AS BranchName, rt.Name AS RoomTypeName, rt.DailyRate
     FROM BOOKED_ROOMS br
     JOIN ROOM r ON r.RoomID = br.RoomID
     JOIN BRANCH bh ON bh.BranchID = r.BranchID
     JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
     WHERE br.BookingID = ?`,
    [id]
  );

  res.json({ ...booking, rooms });
});

// GET /api/bookings?guestId=&status=&branchId=  - search/list bookings
const listBookings = asyncHandler(async (req, res) => {
  const { guestId, status, branchId, guestName, idNumber } = req.query;
  const conditions = [];
  const params = [];

  // A logged-in guest can only ever see their own bookings
  if (req.user.type === 'guest') {
    conditions.push('b.GuestID = ?');
    params.push(req.user.id);
  } else if (guestId) {
    conditions.push('b.GuestID = ?');
    params.push(guestId);
  }

  if (status) {
    conditions.push('b.BookingStatus = ?');
    params.push(status);
  }
  if (branchId) {
    conditions.push('br.BranchID = ?');
    params.push(branchId);
  }
  if (guestName) {
    conditions.push('g.Name LIKE ?');
    params.push(`%${guestName}%`);
  }
  if (idNumber) {
    conditions.push('g.IDNumber = ?');
    params.push(idNumber);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT DISTINCT b.BookingID, b.BookingStatus, b.BookingDate, b.PreferredPaymentMethod,
            g.GuestID, g.Name AS GuestName, g.IDNumber
     FROM BOOKING b
     JOIN GUEST g ON g.GuestID = b.GuestID
     LEFT JOIN BOOKED_ROOMS br ON br.BookingID = b.BookingID
     ${where}
     ORDER BY b.CreatedDate DESC
     LIMIT 200`,
    params
  );
  res.json(rows);
});

module.exports = { makeBooking, cancelBooking, checkIn, checkOut, getBooking, listBookings };
