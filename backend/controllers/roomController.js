const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { validateRoomSearch } = require('../utils/roomSearchValidation');
const { positiveInteger } = require('../utils/bookingValidation');
const { canAct, restrictedRoles } = require('../utils/staffScope');

// ---------- BRANCH ----------

const listBranches = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM BRANCH ORDER BY Name`);
  res.json(rows);
});

const createBranch = asyncHandler(async (req, res) => {
  const { name, location, contactNumber } = req.body;
  if (!name || !location || !contactNumber) {
    return res.status(400).json({ error: 'name, location and contactNumber are required.' });
  }
  const [result] = await pool.execute(
    `INSERT INTO BRANCH (Name, Location, ContactNumber) VALUES (?, ?, ?)`,
    [name, location, contactNumber]
  );
  res.status(201).json({ branchId: result.insertId, name, location, contactNumber });
});

// ---------- ROOM_TYPE + AMENITY ----------

const listRoomTypes = asyncHandler(async (req, res) => {
  const [types] = await pool.execute(`SELECT * FROM ROOM_TYPE ORDER BY DailyRate`);
  const [amenityLinks] = await pool.execute(
    `SELECT rta.RoomTypeID, a.AmenityID, a.AmenityName
     FROM ROOM_TYPE_AMENITY rta JOIN AMENITY a ON a.AmenityID = rta.AmenityID`
  );
  const withAmenities = types.map((t) => ({
    ...t,
    amenities: amenityLinks.filter((a) => a.RoomTypeID === t.RoomTypeID).map((a) => a.AmenityName),
  }));
  res.json(withAmenities);
});

const createRoomType = asyncHandler(async (req, res) => {
  const { name, capacity, dailyRate, amenityIds } = req.body;
  if (!name || !capacity || dailyRate == null) {
    return res.status(400).json({ error: 'name, capacity and dailyRate are required.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO ROOM_TYPE (Name, Capacity, DailyRate) VALUES (?, ?, ?)`,
      [name, capacity, dailyRate]
    );
    const roomTypeId = result.insertId;
    if (Array.isArray(amenityIds) && amenityIds.length) {
      const values = amenityIds.map((id) => [roomTypeId, id]);
      await conn.query(`INSERT INTO ROOM_TYPE_AMENITY (RoomTypeID, AmenityID) VALUES ?`, [values]);
    }
    await conn.commit();
    res.status(201).json({ roomTypeId, name, capacity, dailyRate });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const listAmenities = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM AMENITY ORDER BY AmenityName`);
  res.json(rows);
});

const createAmenity = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required.' });
  const [result] = await pool.execute(`INSERT INTO AMENITY (AmenityName) VALUES (?)`, [name]);
  res.status(201).json({ amenityId: result.insertId, name });
});

// ---------- ROOM ----------

// GET /api/rooms: without dates this is a catalogue, not an availability guarantee.
// Date searches support roomId, branchId, roomTypeId and guestCount filters.
const searchRooms = asyncHandler(async (req, res) => {
  const search = validateRoomSearch(req.query);
  if (search.error) return res.status(400).json({ error: search.error });
  const { roomId, branchId, roomTypeId, guestCount, checkin, checkout } = search.value;

  const conditions = [`r.RoomStatus != 'Maintenance'`];
  const params = [];

  if (roomId !== undefined) {
    conditions.push('r.RoomID = ?');
    params.push(roomId);
  }
  if (branchId !== undefined) {
    conditions.push('r.BranchID = ?');
    params.push(branchId);
  }
  if (roomTypeId !== undefined) {
    conditions.push('r.RoomTypeID = ?');
    params.push(roomTypeId);
  }
  if (guestCount !== undefined) {
    conditions.push('rt.Capacity >= ?');
    params.push(guestCount);
  }

  // A room occupied now can still be reserved for non-overlapping future dates.
  // Strict inequalities allow a new stay to begin at another stay's checkout.
  if (checkin && checkout) {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM BOOKED_ROOMS booked_room
      JOIN BOOKING b ON b.BookingID = booked_room.BookingID
      WHERE booked_room.RoomID = r.RoomID
        AND b.BookingStatus IN ('Booked','Checked-In')
        AND ? < booked_room.CheckOutDateTime AND ? > booked_room.CheckInDateTime
    )`);
    params.push(checkin, checkout);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [rows] = await pool.execute(
    `SELECT r.RoomID, r.RoomNumber, r.RoomStatus, r.BranchID, br.Name AS BranchName,
            rt.RoomTypeID, rt.Name AS RoomTypeName, rt.Capacity, rt.DailyRate
     FROM ROOM r
     JOIN BRANCH br ON br.BranchID = r.BranchID
     JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
     ${where}
     ORDER BY br.Name, r.RoomNumber`,
    params
  );
  res.json(rows);
});

const createRoom = asyncHandler(async (req, res) => {
  const { branchId, roomTypeId, roomNumber } = req.body;
  if (!branchId || !roomTypeId || !roomNumber) {
    return res.status(400).json({ error: 'branchId, roomTypeId and roomNumber are required.' });
  }
  try {
    const [result] = await pool.execute(
      `INSERT INTO ROOM (BranchID, RoomTypeID, RoomNumber) VALUES (?, ?, ?)`,
      [branchId, roomTypeId, roomNumber]
    );
    res.status(201).json({ roomId: result.insertId, branchId, roomTypeId, roomNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That room number already exists at this branch.' });
    }
    throw err;
  }
});

const updateRoomStatus = asyncHandler(async (req, res) => {
  if (!canAct(req, ['Admin', 'Manager', 'Receptionist'])) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Room ID must be a positive whole number.' });
  const roomStatus = req.body?.roomStatus;
  const valid = ['Available', 'Occupied', 'Maintenance'];
  if (!valid.includes(roomStatus)) {
    return res.status(400).json({ error: `roomStatus must be one of ${valid.join(', ')}` });
  }
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.execute(
      `SELECT s.StaffID, s.Role, s.BranchID FROM STAFF s
       JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID WHERE s.StaffID = ? FOR SHARE`, [req.staffScope.staffId]);
    if (!current || current.StaffID !== req.staffScope.staffId || current.Role !== req.staffScope.role
        || current.BranchID !== req.staffScope.branchId) throw fail(403, 'Your staff access has changed. Please sign in again.');
    const [[room]] = await conn.execute('SELECT RoomID, BranchID FROM ROOM WHERE RoomID = ? FOR UPDATE', [id]);
    if (!room || (restrictedRoles.has(current.Role) && room.BranchID !== current.BranchID)) throw fail(404, 'Room not found.');
    if (roomStatus === 'Maintenance') {
      // The ROOM lock serializes concurrent creates/edits; a current locking
      // read preserves the existing active-booking maintenance guard.
      const [[active]] = await conn.execute(
        `SELECT br.BookedRoomID FROM BOOKED_ROOMS br
         JOIN BOOKING b ON b.BookingID = br.BookingID
         WHERE br.RoomID = ? AND b.BookingStatus IN ('Booked','Checked-In')
         LIMIT 1 FOR SHARE`, [id]);
      if (active) throw fail(409, 'Cannot modify a room that has an active booking.');
    }
    await conn.execute('UPDATE ROOM SET RoomStatus = ? WHERE RoomID = ?', [roomStatus, id]);
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* Preserve the original error. */ }
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code)) {
      return res.status(409).json({ error: 'Another room or booking action is in progress. Refresh and try again.' });
    }
    throw err;
  } finally { conn.release(); }
  res.json({ roomId: id, roomStatus });
});
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

// DailyRate must be a positive number with at most 2 decimal places.
function cleanRate(value) {
  const n = Number(value);
  if (value === '' || value === null || !Number.isFinite(n) || n <= 0 || n >= 100000000) return null;
  return Math.round(n * 100) / 100 === n ? n : null;
}

function handleDbError(err, res, inUseMessage) {
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    res.status(409).json({ error: inUseMessage });
    return true;
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    res.status(400).json({ error: 'The branch, room type or amenity you referred to does not exist.' });
    return true;
  }
  if (err.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: 'That value already exists.' });
    return true;
  }
  if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    res.status(400).json({ error: 'One of the values is not allowed.' });
    return true;
  }
  return false;
}

async function roomHasActiveBooking(conn, roomId) {
  const [[active]] = await conn.execute(
    `SELECT br.BookedRoomID FROM BOOKED_ROOMS br
     JOIN BOOKING b ON b.BookingID = br.BookingID
     WHERE br.RoomID = ? AND b.BookingStatus IN ('Booked','Checked-In')
     LIMIT 1 FOR SHARE`,
    [roomId]
  );
  return Boolean(active);
}

const updateBranch = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Branch ID must be a positive whole number.' });

  const body = req.body || {};
  const name = body.name === undefined ? undefined : cleanText(body.name, 100);
  const location = body.location === undefined ? undefined : cleanText(body.location, 150);
  const contactNumber = body.contactNumber === undefined ? undefined : cleanText(body.contactNumber, 20);

  if (name === null) return res.status(400).json({ error: 'name must be 1 to 100 characters.' });
  if (location === null) return res.status(400).json({ error: 'location must be 1 to 150 characters.' });
  if (contactNumber === null) return res.status(400).json({ error: 'contactNumber must be 1 to 20 characters.' });
  if (name === undefined && location === undefined && contactNumber === undefined) {
    return res.status(400).json({ error: 'Send at least one of name, location, contactNumber.' });
  }

  const [result] = await pool.execute(
    `UPDATE BRANCH
     SET Name = COALESCE(?, Name),
         Location = COALESCE(?, Location),
         ContactNumber = COALESCE(?, ContactNumber)
     WHERE BranchID = ?`,
    [name ?? null, location ?? null, contactNumber ?? null, id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Branch not found.' });
  res.json({ branchId: id, message: 'Branch updated.' });
});

const deleteBranch = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Branch ID must be a positive whole number.' });
  try {
    const [result] = await pool.execute('DELETE FROM BRANCH WHERE BranchID = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Branch not found.' });
    res.json({ branchId: id, message: 'Branch deleted.' });
  } catch (err) {
    if (handleDbError(err, res, 'Cannot delete this branch: rooms or staff still belong to it.')) return;
    throw err;
  }
});

const updateRoomType = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Room type ID must be a positive whole number.' });

  const body = req.body || {};
  const name = body.name === undefined ? undefined : cleanText(body.name, 100);
  const capacity = body.capacity === undefined ? undefined : positiveInteger(body.capacity);
  const dailyRate = body.dailyRate === undefined ? undefined : cleanRate(body.dailyRate);

  if (name === null) return res.status(400).json({ error: 'name must be 1 to 100 characters.' });
  if (capacity === null) return res.status(400).json({ error: 'capacity must be a positive whole number.' });
  if (dailyRate === null) return res.status(400).json({ error: 'dailyRate must be a positive number with at most 2 decimals.' });

  // Optional: amenityIds replaces the room type's whole amenity list.
  let amenityIds;
  if (body.amenityIds !== undefined) {
    const ids = Array.isArray(body.amenityIds) ? body.amenityIds.map((x) => positiveInteger(x)) : null;
    if (!ids || ids.includes(null)) {
      return res.status(400).json({ error: 'amenityIds must be a list of positive whole numbers.' });
    }
    amenityIds = [...new Set(ids)];
  }

  if (name === undefined && capacity === undefined && dailyRate === undefined && amenityIds === undefined) {
    return res.status(400).json({ error: 'Send at least one of name, capacity, dailyRate, amenityIds.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE ROOM_TYPE
       SET Name = COALESCE(?, Name),
           Capacity = COALESCE(?, Capacity),
           DailyRate = COALESCE(?, DailyRate)
       WHERE RoomTypeID = ?`,
      [name ?? null, capacity ?? null, dailyRate ?? null, id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Room type not found.' });
    }
    if (amenityIds !== undefined) {
      await conn.execute('DELETE FROM ROOM_TYPE_AMENITY WHERE RoomTypeID = ?', [id]);
      if (amenityIds.length) {
        await conn.query('INSERT INTO ROOM_TYPE_AMENITY (RoomTypeID, AmenityID) VALUES ?', [
          amenityIds.map((amenityId) => [id, amenityId]),
        ]);
      }
    }
    await conn.commit();
    res.json({ roomTypeId: id, message: 'Room type updated.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* keep the original error */ }
    if (handleDbError(err, res, 'This room type is in use.')) return;
    throw err;
  } finally {
    conn.release();
  }
});

const deleteRoomType = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Room type ID must be a positive whole number.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Remove its amenity links first, then the room type itself.
    await conn.execute('DELETE FROM ROOM_TYPE_AMENITY WHERE RoomTypeID = ?', [id]);
    const [result] = await conn.execute('DELETE FROM ROOM_TYPE WHERE RoomTypeID = ?', [id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Room type not found.' });
    }
    await conn.commit();
    res.json({ roomTypeId: id, message: 'Room type deleted.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* keep the original error */ }
    if (handleDbError(err, res, 'Cannot delete this room type: rooms still use it.')) return;
    throw err;
  } finally {
    conn.release();
  }
});


const updateAmenity = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Amenity ID must be a positive whole number.' });

  const name = cleanText((req.body || {}).name, 100);
  if (name === null) return res.status(400).json({ error: 'name must be 1 to 100 characters.' });

  try {
    const [result] = await pool.execute('UPDATE AMENITY SET AmenityName = ? WHERE AmenityID = ?', [name, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Amenity not found.' });
    res.json({ amenityId: id, name, message: 'Amenity updated.' });
  } catch (err) {
    if (handleDbError(err, res, 'This amenity is in use.')) return;
    throw err;
  }
});

const deleteAmenity = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Amenity ID must be a positive whole number.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Unlink it from every room type, then delete it.
    await conn.execute('DELETE FROM ROOM_TYPE_AMENITY WHERE AmenityID = ?', [id]);
    const [result] = await conn.execute('DELETE FROM AMENITY WHERE AmenityID = ?', [id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Amenity not found.' });
    }
    await conn.commit();
    res.json({ amenityId: id, message: 'Amenity deleted.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* keep the original error */ }
    if (handleDbError(err, res, 'Cannot delete this amenity: it is still in use.')) return;
    throw err;
  } finally {
    conn.release();
  }
});



const updateRoom = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Room ID must be a positive whole number.' });

  const body = req.body || {};
  const roomNumber = body.roomNumber === undefined ? undefined : cleanText(body.roomNumber, 10);
  const roomTypeId = body.roomTypeId === undefined ? undefined : positiveInteger(body.roomTypeId);

  if (roomNumber === null) return res.status(400).json({ error: 'roomNumber must be 1 to 10 characters.' });
  if (roomTypeId === null) return res.status(400).json({ error: 'roomTypeId must be a positive whole number.' });
  if (roomNumber === undefined && roomTypeId === undefined) {
    return res.status(400).json({ error: 'Send at least one of roomNumber, roomTypeId.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Lock the room row so a booking cannot slip in while we edit.
    const [[room]] = await conn.execute('SELECT RoomID FROM ROOM WHERE RoomID = ? FOR UPDATE', [id]);
    if (!room) {
      await conn.rollback();
      return res.status(404).json({ error: 'Room not found.' });
    }
    if (await roomHasActiveBooking(conn, id)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Cannot modify a room that has an active booking.' });
    }
    await conn.execute(
      `UPDATE ROOM
       SET RoomNumber = COALESCE(?, RoomNumber),
           RoomTypeID = COALESCE(?, RoomTypeID)
       WHERE RoomID = ?`,
      [roomNumber ?? null, roomTypeId ?? null, id]
    );
    await conn.commit();
    res.json({ roomId: id, message: 'Room updated.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* keep the original error */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That room number already exists at this branch.' });
    }
    if (handleDbError(err, res, 'This room is in use.')) return;
    throw err;
  } finally {
    conn.release();
  }
});

const deleteRoom = asyncHandler(async (req, res) => {
  const id = positiveInteger(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Room ID must be a positive whole number.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[room]] = await conn.execute('SELECT RoomID FROM ROOM WHERE RoomID = ? FOR UPDATE', [id]);
    if (!room) {
      await conn.rollback();
      return res.status(404).json({ error: 'Room not found.' });
    }
    if (await roomHasActiveBooking(conn, id)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Cannot delete a room that has an active booking.' });
    }
    await conn.execute('DELETE FROM ROOM WHERE RoomID = ?', [id]);
    await conn.commit();
    res.json({ roomId: id, message: 'Room deleted.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* keep the original error */ }
    if (handleDbError(err, res, 'This room has booking history and cannot be deleted. Set its status to Maintenance instead.')) return;
    throw err;
  } finally {
    conn.release();
  }
});
module.exports = {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  listRoomTypes,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  listAmenities,
  createAmenity,
  updateAmenity,
  deleteAmenity,
  searchRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
};
