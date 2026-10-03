const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { validateRoomSearch } = require('../utils/roomSearchValidation');

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
  const { id } = req.params;
  const { roomStatus } = req.body;
  const valid = ['Available', 'Occupied', 'Maintenance'];
  if (!valid.includes(roomStatus)) {
    return res.status(400).json({ error: `roomStatus must be one of ${valid.join(', ')}` });
  }

  // Guard: don't let a room be pulled into Maintenance while it has an active booking
  const [[{ activeCount }]] = (
    await pool.execute(
      `SELECT COUNT(*) AS activeCount FROM BOOKED_ROOMS br
       JOIN BOOKING b ON b.BookingID = br.BookingID
       WHERE br.RoomID = ? AND b.BookingStatus IN ('Booked','Checked-In')`,
      [id]
    )
  );
  if (roomStatus === 'Maintenance' && activeCount > 0) {
    return res.status(409).json({ error: 'Cannot modify a room that has an active booking.' });
  }

  const [result] = await pool.execute(`UPDATE ROOM SET RoomStatus = ? WHERE RoomID = ?`, [roomStatus, id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Room not found.' });
  res.json({ roomId: id, roomStatus });
});

module.exports = {
  listBranches,
  createBranch,
  listRoomTypes,
  createRoomType,
  listAmenities,
  createAmenity,
  searchRooms,
  createRoom,
  updateRoomStatus,
};
