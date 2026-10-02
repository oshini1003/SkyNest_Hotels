const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

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
  const { name, contactNumber, email, address } = req.body;

  if (!name && !contactNumber && (email === undefined) && (address === undefined)) {
    return res.status(400).json({ error: 'Provide at least one field to update (name, contactNumber, email, address).' });
  }

  // Build dynamic SET clause — only update the fields that were sent
  const fields = [];
  const values = [];

  if (name) {
    fields.push('Name = ?');
    values.push(name);
  }
  if (contactNumber) {
    fields.push('ContactNumber = ?');
    values.push(contactNumber);
  }
  if (email !== undefined) {
    fields.push('Email = ?');
    values.push(email || null);
  }
  if (address !== undefined) {
    fields.push('Address = ?');
    values.push(address || null);
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

  res.json({ message: 'Profile updated successfully.', guest: rows[0] });
});

module.exports = { getProfile, updateProfile };
