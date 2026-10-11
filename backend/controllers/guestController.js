const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { validateGuestProfile } = require('../utils/guestValidation');

// GET /api/guests/me — return the authenticated guest's profile
const getProfile = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT g.GuestID, g.Name, g.ContactNumber, g.Email, g.IDNumber, g.Address, ga.Username
     FROM GUEST g
     JOIN GUEST_ACCOUNT ga ON ga.GuestID = g.GuestID
     WHERE g.GuestID = ?`,
    [req.user.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Guest not found.' });
  }

  res.json(rows[0]);
});

// PUT /api/guests/me — update the authenticated guest's profile
const updateProfile = asyncHandler(async (req, res) => {
  const parsed = validateGuestProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const columns = { name: 'Name', contactNumber: 'ContactNumber', email: 'Email', address: 'Address' };
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(parsed.value)) {
    fields.push(`${columns[key]} = ?`);
    values.push(value);
  }

  values.push(req.user.id); // WHERE clause

  await pool.execute(
    `UPDATE GUEST SET ${fields.join(', ')} WHERE GuestID = ?`,
    values
  );

  // Return the updated profile
  const [rows] = await pool.execute(
    `SELECT g.GuestID, g.Name, g.ContactNumber, g.Email, g.IDNumber, g.Address, ga.Username
     FROM GUEST g
     JOIN GUEST_ACCOUNT ga ON ga.GuestID = g.GuestID
     WHERE g.GuestID = ?`,
    [req.user.id]
  );

  if (!rows.length) return res.status(404).json({ error: 'Guest not found.' });
  res.json({ message: 'Profile updated successfully.', guest: rows[0] });
});


// GET /api/guests?q= — staff search by name, phone, email or ID number
const searchGuests = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({ error: 'Enter at least 2 characters to search.' });
  }
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const [rows] = await pool.execute(
    `SELECT GuestID, Name, ContactNumber, Email, IDNumber
     FROM GUEST
     WHERE Name LIKE ? OR ContactNumber LIKE ? OR Email LIKE ? OR IDNumber LIKE ?
     ORDER BY Name LIMIT 20`,
    [like, like, like, like]
  );
  res.json(rows);
});

// POST /api/guests — staff register a walk-in guest (no login account)
const createGuest = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { idNumber, ...profile } = body;
  if (idNumber !== undefined && (typeof idNumber !== 'string' || idNumber.trim().length > 255)) {
    return res.status(400).json({ error: 'ID number must be text of 255 characters or fewer.' });
  }
  const parsed = validateGuestProfile(profile);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, contactNumber, email, address } = parsed.value;
  if (!name || !contactNumber) {
    return res.status(400).json({ error: 'Name and contact number are required.' });
  }
  const nic = idNumber?.trim() || null;
  try {
    const [result] = await pool.execute(
      'INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES (?, ?, ?, ?, ?)',
      [name, contactNumber, email ?? null, nic, address ?? null]
    );
    res.status(201).json({
      guest: { GuestID: result.insertId, Name: name, ContactNumber: contactNumber, Email: email ?? null, IDNumber: nic },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A guest with these details already exists. Search for them instead.' });
    }
    throw err;
  }
});

module.exports = { getProfile, updateProfile, searchGuests, createGuest };
