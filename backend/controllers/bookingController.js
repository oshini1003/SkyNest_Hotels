const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { positiveInteger, validateBooking, validateBookingFilters, checkInEligibility } = require('../utils/bookingValidation');
const { validateRoomSearch } = require('../utils/roomSearchValidation');

const { canRead, canAct, bookingAccess, roomAccess, bookingRead, scopeConflict, restrictedRoles } = require('../utils/staffScope');
const bookingRoles = ['Admin', 'Manager', 'Receptionist'];
const forbidden = res => res.status(403).json({ error: 'You do not have permission to perform this action.' });
const notFound = res => res.status(404).json({ error: 'Booking not found.' });
const canManage = req => canAct(req, bookingRoles, true);

function conflictResponse(err, res) {
  if (scopeConflict(err, res)) return true;
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
    if (staffId !== null) {
      const [[current]] = await conn.execute(
        `SELECT s.StaffID, s.Role, s.BranchID FROM STAFF s
         JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID WHERE s.StaffID = ? FOR SHARE`, [staffId]);
      if (!current || current.StaffID !== staffId || current.Role !== req.staffScope.role
          || current.BranchID !== req.staffScope.branchId) throw httpError(403, 'Your staff access has changed. Please sign in again.');
    }
    // Lock and authorize all destination rooms before the first booking insert.
    const lockedRooms = new Map();
    for (const stay of stays) {
      const [[room]] = await conn.execute(
        `SELECT r.BranchID, r.RoomStatus, rt.Capacity FROM ROOM r JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
         WHERE r.RoomID = ? FOR UPDATE OF r`, [stay.roomId]);
      if (!room || (staffId !== null && restrictedRoles.has(req.staffScope.role)
          && room.BranchID !== req.staffScope.branchId)) throw httpError(404, 'Room not found.');
      lockedRooms.set(stay.roomId, room);
    }
    const [header] = await conn.execute(
      'INSERT INTO BOOKING (GuestID, StaffID, PreferredPaymentMethod) VALUES (?, ?, ?)',
      [guestId, staffId, paymentMethod]);
    for (const stay of stays) {
      const room = lockedRooms.get(stay.roomId);
      if (room.RoomStatus === 'Maintenance') throw httpError(409, `Room ${stay.roomId} is under maintenance.`);
      if (stay.guestCount > room.Capacity) throw httpError(400, `Room ${stay.roomId} sleeps at most ${room.Capacity}.`);
      // The exclusive ROOM lock serializes competing creates/edits for this room.
      // A shared locking read still sees stays committed while we waited, without
      // requiring UPDATE privileges on BOOKED_ROOMS merely to check availability.
      const [[clash]] = await conn.execute(
        `SELECT br.BookedRoomID FROM BOOKED_ROOMS br
         JOIN BOOKING b ON b.BookingID = br.BookingID
         WHERE br.RoomID = ? AND b.BookingStatus IN ('Booked','Checked-In')
           AND ? < br.CheckOutDateTime AND ? > br.CheckInDateTime
         LIMIT 1 FOR SHARE`, [stay.roomId, stay.checkin, stay.checkout]);
      if (clash) throw httpError(409, 'Room is already booked for an overlapping period.');
      await conn.execute(
        `INSERT INTO BOOKED_ROOMS (BookingID, RoomID, CheckInDateTime, CheckOutDateTime, GuestCount)
         VALUES (?, ?, ?, ?, ?)`,
        [header.insertId, stay.roomId, stay.checkin, stay.checkout, stay.guestCount]);
    }
    await conn.commit();
    res.status(201).json({ bookingId: header.insertId, status: 'Booked', rooms: stays.length });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* Preserve the original failure. */ }
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
  if (!canManage(req)) return forbidden(res);
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
    if (staffId !== null) {
      const access = roomAccess(req);
      const [[room]] = await conn.execute(`SELECT r.RoomID FROM ROOM r WHERE r.RoomID = ?${access.sql}`, [roomId, ...access.params]);
      if (!room) return res.status(404).json({ error: 'Room not found.' });
    }
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

// Lock the booking before checking branch membership, just like room-edit and
// check-in procedures. Do not put ROOM in this UPDATE: the booking status trigger
// itself updates ROOM, which MySQL prohibits when the invoking UPDATE reads it.
const cancelBooking = asyncHandler(async (req, res) => {
  if (!canManage(req)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  const own = req.user.type === 'guest';
  const ownerCondition = own ? ' AND BOOKING.GuestID = ?' : '';
  const params = own ? [id, req.user.id] : [id];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[booking]] = await connection.execute(
      `SELECT BookingStatus FROM BOOKING WHERE BookingID = ?${ownerCondition} FOR UPDATE`, params);
    if (!booking) throw httpError(404, 'Booking not found.');
    if (!own) {
      const [[current]] = await connection.execute(
        `SELECT s.StaffID, s.Role, s.BranchID FROM STAFF s
         JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID WHERE s.StaffID = ? FOR SHARE`, [req.staffScope.staffId]);
      if (!current || current.StaffID !== req.staffScope.staffId || current.Role !== req.staffScope.role
          || current.BranchID !== req.staffScope.branchId) throw httpError(403, 'Your staff access has changed. Please sign in again.');
      if (restrictedRoles.has(current.Role)) {
        const [rooms] = await connection.execute(
          `SELECT br.BookedRoomID, r.BranchID FROM BOOKED_ROOMS br
           LEFT JOIN ROOM r ON r.RoomID = br.RoomID
           WHERE br.BookingID = ? ORDER BY br.BookedRoomID FOR SHARE OF br`, [id]);
        if (!rooms.length || rooms.some(room => room.BranchID !== current.BranchID)) throw httpError(404, 'Booking not found.');
      }
    }
    if (booking.BookingStatus !== 'Booked') throw httpError(409, 'Only a Booked reservation can be cancelled.');
    const [result] = await connection.execute(
      `UPDATE BOOKING SET BookingStatus = 'Cancelled' WHERE BookingID = ?${ownerCondition} AND BookingStatus = 'Booked'`, params);
    if (result.affectedRows !== 1) throw httpError(409, 'Only a Booked reservation can be cancelled.');
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (_) { /* Preserve original failure. */ }
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (conflictResponse(err, res)) return;
    throw err;
  } finally { connection.release(); }
  res.json({ bookingId: id, status: 'Cancelled' });
});

// Front desk actions are also protected by requireRole in bookingRoutes.
const checkIn = asyncHandler(async (req, res) => {
  if (!canAct(req, bookingRoles)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  try {
    const access = bookingAccess(req);
    const found = await bookingRead(req, async conn => {
      const [[booking]] = await conn.execute(
        `SELECT BookingStatus, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS ServerToday FROM BOOKING WHERE BookingID = ?${access.sql}`, [id, ...access.params]);
      if (!booking) return null;
      const [rooms] = await conn.execute(`${roomSelect} WHERE br.BookingID = ? ORDER BY br.BookedRoomID`, [id]);
      return { booking, rooms };
    });
    if (!found) return notFound(res);
    const { booking, rooms } = found;
    const eligibility = checkInEligibility(booking, rooms, booking.ServerToday);
    if (!eligibility.allowed) return res.status(409).json({ error: eligibility.reason });
    // The procedure owns its transaction. Its booking lock and room-status
    // trigger recheck state after these reads, including concurrent check-ins.
    // Audit identity comes only from the authenticated staff token.
    await pool.execute('CALL sp_check_in(?, ?)', [id, positiveInteger(req.user.id)]);
    res.json({ bookingId: id, status: 'Checked-In' });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

const checkOut = asyncHandler(async (req, res) => {
  if (!canAct(req, bookingRoles)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  try {
    const access = bookingAccess(req);
    const [[booking]] = await pool.execute(`SELECT BookingStatus FROM BOOKING WHERE BookingID = ?${access.sql}`, [id, ...access.params]);
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
    const access = bookingAccess(req, 'b');
    [[bill]] = await pool.execute(`SELECT bill.* FROM BILL bill JOIN BOOKING b ON b.BookingID = bill.BookingID WHERE b.BookingID = ?${access.sql}`, [id, ...access.params]);
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
  if (!canRead(req)) return forbidden(res);
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Booking ID must be a positive whole number.' });
  const own = req.user.type === 'guest';
  const access = bookingAccess(req, 'b');
  const found = await bookingRead(req, async conn => {
    const [[booking]] = await conn.execute(
      `SELECT b.*, g.Name AS GuestName, g.ContactNumber AS GuestContact,
              g.IDNumber AS GuestIDNumber, g.Email AS GuestEmail, s.Name AS StaffName,
              DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS ServerToday
       FROM BOOKING b JOIN GUEST g ON g.GuestID = b.GuestID
       LEFT JOIN STAFF s ON s.StaffID = b.StaffID
       WHERE b.BookingID = ?${access.sql}`, [id, ...access.params]);
    if (!booking) return null;
    const [rooms] = await conn.execute(`${roomSelect} WHERE br.BookingID = ? ORDER BY br.BookedRoomID`, [id]);
    return { booking, rooms };
  });
  if (!found) return notFound(res);
  const { booking, rooms } = found;
  const { ServerToday, ...details } = booking;
  res.json({ ...details, rooms,
    ...(own ? {} : { checkInEligibility: checkInEligibility(booking, rooms, ServerToday) }) });
});

// Two queries fetch the headers and all their rooms; adding bookings does not
// cause a separate database round trip for each one.
const listBookings = asyncHandler(async (req, res) => {
  if (!canRead(req)) return forbidden(res);
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
  if (req.user.type === 'staff') {
    const access = bookingAccess(req, 'b');
    conditions.push(access.sql.slice(5));
    params.push(...access.params);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await bookingRead(req, async conn => {
    const [rows] = await conn.query(
      `SELECT DISTINCT b.BookingID, b.BookingStatus, b.BookingDate, b.CreatedDate, b.PreferredPaymentMethod,
              g.GuestID, g.Name AS GuestName, g.IDNumber
       FROM BOOKING b JOIN GUEST g ON g.GuestID = b.GuestID
       LEFT JOIN BOOKED_ROOMS br ON br.BookingID = b.BookingID
       LEFT JOIN ROOM r ON r.RoomID = br.RoomID
       ${where} ORDER BY b.CreatedDate DESC, b.BookingID DESC LIMIT 200`, params);
    if (!rows.length) return [];
    const ids = rows.map(row => row.BookingID);
    const [rooms] = await conn.execute(
      `${roomSelect} WHERE br.BookingID IN (${ids.map(() => '?').join(', ')}) ORDER BY br.BookingID, br.BookedRoomID`, ids);
    const roomsByBooking = new Map(ids.map(id => [id, []]));
    for (const room of rooms) roomsByBooking.get(room.BookingID)?.push(room);
    return rows.map(row => ({ ...row, rooms: roomsByBooking.get(row.BookingID) }));
  });
  res.json(result);
});

const updateFields = ['bookedRoomId', 'roomId', 'checkin', 'checkout', 'guestCount'];

// PATCH /api/bookings/:id - change room, dates or guest count of one room entry
// on a Booked reservation. sp_update_booked_room and the update trigger enforce
// status, capacity, maintenance and overlap under locks.
const updateBooking = asyncHandler(async (req, res) => {
  if (!canManage(req)) return forbidden(res);
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

  try {
    const access = bookingAccess(req);
    const lines = await bookingRead(req, async conn => {
      const [[booking]] = await conn.execute(
        `SELECT BookingID FROM BOOKING WHERE BookingID = ?${access.sql}`, [id, ...access.params]);
      if (!booking) return null;
      const [rows] = await conn.execute(
        `SELECT BookedRoomID, DATE_FORMAT(CheckInDateTime, '%Y-%m-%d') AS CheckInDate,
                DATE_FORMAT(CheckOutDateTime, '%Y-%m-%d') AS CheckOutDate
         FROM BOOKED_ROOMS WHERE BookingID = ? ORDER BY BookedRoomID`, [id]);
      return rows;
    });
    if (!lines) return notFound(res);
    if (req.user.type === 'staff' && change.roomId !== null) {
      const roomScope = roomAccess(req);
      const [[room]] = await pool.execute(`SELECT r.RoomID FROM ROOM r WHERE r.RoomID = ?${roomScope.sql}`, [change.roomId, ...roomScope.params]);
      if (!room) return notFound(res);
    }
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
    await pool.execute('CALL sp_update_booked_room(?, ?, ?, ?, ?, ?, ?)',
      [id, line.BookedRoomID, change.roomId, checkin, checkout, change.guestCount, req.user.type === 'staff' ? req.staffScope.staffId : null]);
    res.json({ bookingId: id, bookedRoomId: line.BookedRoomID, status: 'Booked', updated: true });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    throw err;
  }
});

module.exports = { makeBooking, updateBooking, cancelBooking, checkIn, checkOut, getBooking, listBookings };
