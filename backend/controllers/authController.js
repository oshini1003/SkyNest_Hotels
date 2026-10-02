const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/guest/register
const registerGuest = asyncHandler(async (req, res) => {
  const { name, contactNumber, email, idNumber, address, username, password } = req.body;
  if (!name || !contactNumber || !idNumber || !username || !password) {
    return res.status(400).json({ error: 'name, contactNumber, idNumber, username and password are required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [guestResult] = await conn.execute(
      `INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES (?, ?, ?, ?, ?)`,
      [name, contactNumber, email || null, idNumber, address || null]
    );
    const guestId = guestResult.insertId;

    const passwordHash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO GUEST_ACCOUNT (GuestID, Username, PasswordHash) VALUES (?, ?, ?)`,
      [guestId, username, passwordHash]
    );

    await conn.commit();

    const token = signToken({ type: 'guest', id: guestId, username });
    res.status(201).json({ token, guest: { guestId, name, username } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or ID number already registered.' });
    }
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/auth/guest/login
const loginGuest = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await pool.execute(
    `SELECT ga.GuestID, ga.Username, ga.PasswordHash, g.Name
     FROM GUEST_ACCOUNT ga JOIN GUEST g ON g.GuestID = ga.GuestID
     WHERE ga.Username = ?`,
    [username]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password.' });

  const account = rows[0];
  const ok = await bcrypt.compare(password || '', account.PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

  const token = signToken({ type: 'guest', id: account.GuestID, username: account.Username });
  res.json({ token, guest: { guestId: account.GuestID, name: account.Name, username: account.Username } });
});

// POST /api/auth/staff/login
const loginStaff = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await pool.execute(
    `SELECT sa.StaffID, sa.Username, sa.PasswordHash, s.Name, s.Role, s.BranchID
     FROM STAFF_ACCOUNT sa JOIN STAFF s ON s.StaffID = sa.StaffID
     WHERE sa.Username = ?`,
    [username]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password.' });

  const account = rows[0];
  const ok = await bcrypt.compare(password || '', account.PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

  const token = signToken({
    type: 'staff',
    id: account.StaffID,
    username: account.Username,
    role: account.Role,
    branchId: account.BranchID,
  });
  res.json({
    token,
    staff: {
      staffId: account.StaffID,
      name: account.Name,
      role: account.Role,
      branchId: account.BranchID,
      username: account.Username,
    },
  });
});

// POST /api/auth/staff/register
const registerStaff = asyncHandler(async (req, res) => {
  const { branchId, name, role, email, username, password } = req.body;
  const validRoles = ['Admin', 'Manager', 'Receptionist', 'ServiceStaff'];
  if (!name || !role || !username || !password || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'name, a valid role, username and password are required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [staffResult] = await conn.execute(
      `INSERT INTO STAFF (BranchID, Name, Role, Email) VALUES (?, ?, ?, ?)`,
      [branchId || null, name, role, email || null]
    );
    const staffId = staffResult.insertId;

    const passwordHash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO STAFF_ACCOUNT (StaffID, Username, PasswordHash) VALUES (?, ?, ?)`,
      [staffId, username, passwordHash]
    );

    await conn.commit();
    res.status(201).json({ staffId, name, role, username });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already taken.' });
    }
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = { registerGuest, loginGuest, loginStaff, registerStaff };
