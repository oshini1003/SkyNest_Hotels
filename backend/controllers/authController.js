const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../config/auth');
const { validateGuestRegistration, validateStaffRegistration, validateCredentials, validatePasswordChange } = require('../utils/guestValidation');

const tokenDigest = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function transaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function createTokens(conn, payload) {
  const token = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload.type, payload.id);
  const expiresAt = new Date(jwt.decode(refreshToken).exp * 1000);
  // Store only a digest, so a database token row cannot be used as a credential.
  await conn.execute(
    'INSERT INTO REFRESH_TOKEN (UserType, UserID, Token, ExpiresAt) VALUES (?, ?, ?, ?)',
    [payload.type, payload.id, tokenDigest(refreshToken), expiresAt]
  );
  return { token, accessToken: token, refreshToken };
}

// Account rows are locked before refresh-token rows in all authentication transactions.
async function findAccount(conn, type, column, value) {
  const sql = type === 'guest'
    ? `SELECT ga.GuestID, ga.Username, ga.PasswordHash, g.Name
       FROM GUEST_ACCOUNT ga JOIN GUEST g ON g.GuestID = ga.GuestID
       WHERE ga.${column === 'id' ? 'GuestID' : 'Username'} = ? FOR UPDATE`
    : `SELECT sa.StaffID, sa.Username, sa.PasswordHash, s.Name, s.Role, s.BranchID
       FROM STAFF_ACCOUNT sa JOIN STAFF s ON s.StaffID = sa.StaffID
       WHERE sa.${column === 'id' ? 'StaffID' : 'Username'} = ? FOR UPDATE`;
  const [rows] = await conn.execute(sql, [value]);
  return rows[0];
}

function accountPayload(type, account) {
  if (type === 'guest') return { type, id: account.GuestID, username: account.Username };
  return { type, id: account.StaffID, username: account.Username, role: account.Role, branchId: account.BranchID };
}

// POST /api/auth/guest/register
const registerGuest = asyncHandler(async (req, res) => {
  const parsed = validateGuestRegistration(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, contactNumber, email, idNumber, address, username, password } = parsed.value;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await transaction(async (conn) => {
      const [guest] = await conn.execute(
        'INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES (?, ?, ?, ?, ?)',
        [name, contactNumber, email, idNumber, address]
      );
      const guestId = guest.insertId;
      await conn.execute('INSERT INTO GUEST_ACCOUNT (GuestID, Username, PasswordHash) VALUES (?, ?, ?)', [guestId, username, passwordHash]);
      const tokens = await createTokens(conn, { type: 'guest', id: guestId, username });
      return { ...tokens, guest: { guestId, name, username } };
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or ID number already registered.' });
    throw error;
  }
});

function login(type) {
  return asyncHandler(async (req, res) => {
    const parsed = validateCredentials(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { username, password } = parsed.value;
    const result = await transaction(async (conn) => {
      const account = await findAccount(conn, type, 'username', username);
      if (!account || !(await bcrypt.compare(password, account.PasswordHash))) return null;
      const tokens = await createTokens(conn, accountPayload(type, account));
      const identity = type === 'guest'
        ? { guestId: account.GuestID, name: account.Name, username: account.Username }
        : { staffId: account.StaffID, name: account.Name, username: account.Username, role: account.Role, branchId: account.BranchID };
      return { ...tokens, [type]: identity };
    });
    if (!result) return res.status(401).json({ error: 'Invalid username or password.' });
    return res.json(result);
  });
}
const loginGuest = login('guest');
const loginStaff = login('staff');

// POST /api/auth/staff/register (Admin role is enforced by the route)
const registerStaff = asyncHandler(async (req, res) => {
  const parsed = validateStaffRegistration(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { branchId, name, role, email, username, password } = parsed.value;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await transaction(async (conn) => {
      const [staff] = await conn.execute('INSERT INTO STAFF (BranchID, Name, Role, Email) VALUES (?, ?, ?, ?)', [branchId, name, role, email]);
      await conn.execute('INSERT INTO STAFF_ACCOUNT (StaffID, Username, PasswordHash) VALUES (?, ?, ?)', [staff.insertId, username, passwordHash]);
      return { staffId: staff.insertId, name, role, username };
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken.' });
    if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Select an existing branch.' });
    throw error;
  }
});

function changePassword(type) {
  return asyncHandler(async (req, res) => {
    const parsed = validatePasswordChange(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { currentPassword, newPassword } = parsed.value;
    const result = await transaction(async (conn) => {
      const account = await findAccount(conn, type, 'id', req.user.id);
      if (!account) return { status: 404, error: 'Account not found.' };
      // A wrong current password is a form error, not an expired login session.
      if (!(await bcrypt.compare(currentPassword, account.PasswordHash))) return { status: 400, error: 'Current password is incorrect.' };
      const passwordHash = await bcrypt.hash(newPassword, 10);
      const sql = type === 'guest'
        ? 'UPDATE GUEST_ACCOUNT SET PasswordHash = ? WHERE GuestID = ?'
        : 'UPDATE STAFF_ACCOUNT SET PasswordHash = ? WHERE StaffID = ?';
      await conn.execute(sql, [passwordHash, req.user.id]);
      await conn.execute('UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE UserType = ? AND UserID = ? AND RevokedAt IS NULL', [type, req.user.id]);
      return null;
    });
    if (result) return res.status(result.status).json({ error: result.error });
    // Existing access tokens expire at their normal short expiry; refresh tokens are revoked.
    return res.json({ message: 'Password changed successfully. Please sign in again.' });
  });
}
const changeGuestPassword = changePassword('guest');
const changeStaffPassword = changePassword('staff');

// POST /api/auth/refresh
const refreshToken = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken;
  if (typeof token !== 'string' || !token || token.length > 2000) {
    return res.status(400).json({ error: 'A valid refresh token is required.' });
  }
  let payload;
  try { payload = verifyRefreshToken(token); }
  catch { return res.status(401).json({ error: 'Invalid or expired refresh token.' }); }

  const result = await transaction(async (conn) => {
    const account = await findAccount(conn, payload.type, 'id', payload.id);
    if (!account) return null;
    const [rows] = await conn.execute(
      `SELECT TokenID, UserType, UserID FROM REFRESH_TOKEN
       WHERE Token = ? AND RevokedAt IS NULL AND ExpiresAt > NOW() FOR UPDATE`,
      [tokenDigest(token)]
    );
    const current = rows[0];
    if (!current || current.UserType !== payload.type || current.UserID !== payload.id) return null;
    await conn.execute('UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE TokenID = ?', [current.TokenID]);
    // If issuing/inserting the replacement fails, rollback restores the old token.
    return createTokens(conn, accountPayload(payload.type, account));
  });
  if (!result) return res.status(401).json({ error: 'Invalid, expired, or revoked refresh token.' });
  return res.json(result);
});

// POST /api/auth/logout — idempotent revocation of the supplied refresh token.
const logout = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken;
  if (token !== undefined && (typeof token !== 'string' || token.length > 2000)) {
    return res.status(400).json({ error: 'Invalid refresh token.' });
  }
  if (token) {
    await pool.execute('UPDATE REFRESH_TOKEN SET RevokedAt = NOW() WHERE Token = ? AND RevokedAt IS NULL', [tokenDigest(token)]);
  }
  return res.json({ message: 'Logged out successfully.' });
});

module.exports = { registerGuest, loginGuest, loginStaff, registerStaff, changeGuestPassword, changeStaffPassword, refreshToken, logout };
