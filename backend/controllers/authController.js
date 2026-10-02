const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m',
  });
}

function signRefreshToken(payload) {
  return jwt.sign(
    { ...payload, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    }
  );
}

async function createAndStoreRefreshToken(userType, userId, username, extraPayload = {}) {
  const payload = { type: userType, id: userId, username, ...extraPayload };
  const refreshToken = signRefreshToken(payload);
  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  await pool.execute(
    `INSERT INTO REFRESH_TOKEN (UserType, UserID, Token, ExpiresAt) VALUES (?, ?, ?, ?)`,
    [userType, userId, refreshToken, expiresAt]
  );

  return refreshToken;
}

const signToken = signAccessToken;

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

    const token = signAccessToken({ type: 'guest', id: guestId, username });
    const refreshToken = await createAndStoreRefreshToken('guest', guestId, username);
    res.status(201).json({
      token,
      accessToken: token,
      refreshToken,
      guest: { guestId, name, username },
    });
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

  const token = signAccessToken({ type: 'guest', id: account.GuestID, username: account.Username });
  const refreshToken = await createAndStoreRefreshToken('guest', account.GuestID, account.Username);
  res.json({
    token,
    accessToken: token,
    refreshToken,
    guest: { guestId: account.GuestID, name: account.Name, username: account.Username },
  });
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

  const accessPayload = {
    type: 'staff',
    id: account.StaffID,
    username: account.Username,
    role: account.Role,
    branchId: account.BranchID,
  };
  const token = signAccessToken(accessPayload);
  const refreshToken = await createAndStoreRefreshToken('staff', account.StaffID, account.Username, {
    role: account.Role,
    branchId: account.BranchID,
  });
  res.json({
    token,
    accessToken: token,
    refreshToken,
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

// PUT /api/auth/guest/password
const changeGuestPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const [rows] = await pool.execute(
    `SELECT PasswordHash FROM GUEST_ACCOUNT WHERE GuestID = ?`,
    [req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

  const ok = await bcrypt.compare(currentPassword, rows[0].PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.execute(
    `UPDATE GUEST_ACCOUNT SET PasswordHash = ? WHERE GuestID = ?`,
    [passwordHash, req.user.id]
  );

  // Invalidate any active refresh tokens for this guest
  await pool.execute(
    `UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE UserType = 'guest' AND UserID = ? AND RevokedAt IS NULL`,
    [req.user.id]
  );

  res.json({ message: 'Password changed successfully.' });
});

// PUT /api/auth/staff/password
const changeStaffPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const [rows] = await pool.execute(
    `SELECT PasswordHash FROM STAFF_ACCOUNT WHERE StaffID = ?`,
    [req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

  const ok = await bcrypt.compare(currentPassword, rows[0].PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.execute(
    `UPDATE STAFF_ACCOUNT SET PasswordHash = ? WHERE StaffID = ?`,
    [passwordHash, req.user.id]
  );

  // Invalidate any active refresh tokens for this staff member
  await pool.execute(
    `UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE UserType = 'staff' AND UserID = ? AND RevokedAt IS NULL`,
    [req.user.id]
  );

  res.json({ message: 'Password changed successfully.' });
});

// POST /api/auth/refresh
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Refresh token is required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }

  const [rows] = await pool.execute(
    `SELECT TokenID, UserType, UserID FROM REFRESH_TOKEN
     WHERE Token = ? AND RevokedAt IS NULL AND ExpiresAt > NOW()`,
    [token]
  );

  if (rows.length === 0) {
    return res.status(401).json({ error: 'Invalid, expired, or revoked refresh token.' });
  }

  const currentRecord = rows[0];

  // Token rotation: Revoke the used refresh token
  await pool.execute(
    `UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE TokenID = ?`,
    [currentRecord.TokenID]
  );

  let accessPayload;
  let refreshExtra = {};

  if (currentRecord.UserType === 'guest') {
    const [gRows] = await pool.execute(
      `SELECT GuestID, Username FROM GUEST_ACCOUNT WHERE GuestID = ?`,
      [currentRecord.UserID]
    );
    if (gRows.length === 0) {
      return res.status(401).json({ error: 'Guest account no longer exists.' });
    }
    accessPayload = { type: 'guest', id: gRows[0].GuestID, username: gRows[0].Username };
  } else if (currentRecord.UserType === 'staff') {
    const [sRows] = await pool.execute(
      `SELECT sa.StaffID, sa.Username, s.Role, s.BranchID
       FROM STAFF_ACCOUNT sa JOIN STAFF s ON s.StaffID = sa.StaffID
       WHERE sa.StaffID = ?`,
      [currentRecord.UserID]
    );
    if (sRows.length === 0) {
      return res.status(401).json({ error: 'Staff account no longer exists.' });
    }
    accessPayload = {
      type: 'staff',
      id: sRows[0].StaffID,
      username: sRows[0].Username,
      role: sRows[0].Role,
      branchId: sRows[0].BranchID,
    };
    refreshExtra = { role: sRows[0].Role, branchId: sRows[0].BranchID };
  } else {
    return res.status(401).json({ error: 'Invalid account type.' });
  }

  const newAccessToken = signAccessToken(accessPayload);
  const newRefreshToken = await createAndStoreRefreshToken(
    currentRecord.UserType,
    currentRecord.UserID,
    accessPayload.username,
    refreshExtra
  );

  res.json({
    token: newAccessToken,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  if (token) {
    await pool.execute(
      `UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE Token = ?`,
      [token]
    );
  }
  res.json({ message: 'Logged out successfully.' });
});

module.exports = {
  registerGuest,
  loginGuest,
  loginStaff,
  registerStaff,
  changeGuestPassword,
  changeStaffPassword,
  refreshToken,
  logout,
};
