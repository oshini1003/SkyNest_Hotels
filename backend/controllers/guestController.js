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

const guestFields = new Set(['name', 'contactNumber', 'email', 'idNumber', 'address']);
const controls = /[\u0000-\u001f\u007f-\u009f]/;

// GET /api/guests?q= — staff search by name, phone, email or ID number.
const searchGuests = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (Object.keys(req.query).some(key => key !== 'q') || q.length < 2 || q.length > 100 || controls.test(q)) {
    return res.status(400).json({ error: 'Enter 2 to 100 characters to search for a guest.' });
  }
  // Use an explicit escape character so %, _ and ! remain literal search text.
  const like = `%${q.replace(/[!%_]/g, '!$&')}%`;
  try {
    const [rows] = await pool.execute(
      `SELECT GuestID, Name, ContactNumber, Email, IDNumber
       FROM GUEST
       WHERE Name LIKE ? ESCAPE '!' OR ContactNumber LIKE ? ESCAPE '!'
          OR Email LIKE ? ESCAPE '!' OR IDNumber LIKE ? ESCAPE '!'
       ORDER BY Name, GuestID LIMIT 20`,
      [like, like, like, like]
    );
    res.json(rows);
  } catch (error) {
    // Keep SQL/driver details out of the shared handler's validation messages.
    throw new Error('Guest search could not be completed.', { cause: error });
  }
});

// POST /api/guests — register a walk-in guest without creating a login account.
const createGuest = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !guestFields.has(key))) {
    return res.status(400).json({ error: 'Provide only name, contactNumber, email, idNumber and address.' });
  }
  const { idNumber, ...profile } = body;
  if (typeof idNumber !== 'string' || !idNumber.trim()
      || [...idNumber.trim()].length > 30 || controls.test(idNumber.trim())) {
    return res.status(400).json({ error: 'NIC / passport number is required and must be at most 30 characters without control characters.' });
  }
  if (Object.values(profile).some(value => typeof value === 'string' && controls.test(value.trim()))) {
    return res.status(400).json({ error: 'Guest details must not contain control characters.' });
  }
  const parsed = validateGuestProfile(profile);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, contactNumber, email, address } = parsed.value;
  if (!name || !contactNumber) {
    return res.status(400).json({ error: 'Name and contact number are required.' });
  }
  const nic = idNumber.trim();
  let result;
  try {
    [result] = await pool.execute(
      'INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES (?, ?, ?, ?, ?)',
      [name, contactNumber, email ?? null, nic, address ?? null]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A guest with these details already exists. Search for them instead.' });
    }
    // A connection failure can follow a saved INSERT. Never retry automatically
    // or return a validation rejection that suggests the write did not happen.
    throw new Error('Guest creation could not be confirmed.', { cause: error });
  }
  if (!result || result.affectedRows !== 1 || !Number.isInteger(result.insertId)
      || result.insertId < 1 || result.insertId > 2147483647) {
    throw new Error('Guest creation could not be confirmed.');
  }
  res.status(201).json({
    guest: { GuestID: result.insertId, Name: name, ContactNumber: contactNumber, Email: email ?? null, IDNumber: nic },
  });
});

module.exports = { getProfile, updateProfile, searchGuests, createGuest };
