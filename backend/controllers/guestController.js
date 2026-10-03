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

module.exports = { getProfile, updateProfile };
