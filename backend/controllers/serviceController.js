const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/services
const listServices = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM SERVICE_CATALOGUE WHERE IsActive = TRUE ORDER BY ServiceName`);
  res.json(rows);
});

// POST /api/services  (Manager/Admin only)
const createService = asyncHandler(async (req, res) => {
  const { serviceName, description, unitPrice } = req.body;
  if (!serviceName || unitPrice == null) {
    return res.status(400).json({ error: 'serviceName and unitPrice are required.' });
  }
  const [result] = await pool.execute(
    `INSERT INTO SERVICE_CATALOGUE (ServiceName, Description, UnitPrice) VALUES (?, ?, ?)`,
    [serviceName, description || null, unitPrice]
  );
  res.status(201).json({ serviceId: result.insertId, serviceName, unitPrice });
});

// PUT /api/services/:id  (Manager/Admin only) - update price/description, or retire (IsActive=false)
const updateService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { serviceName, description, unitPrice, isActive } = req.body;

  const [result] = await pool.execute(
    `UPDATE SERVICE_CATALOGUE
     SET ServiceName = COALESCE(?, ServiceName),
         Description = COALESCE(?, Description),
         UnitPrice = COALESCE(?, UnitPrice),
         IsActive = COALESCE(?, IsActive)
     WHERE ServiceID = ?`,
    [serviceName ?? null, description ?? null, unitPrice ?? null, isActive ?? null, id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Service not found.' });
  res.json({ serviceId: id, updated: true });
});

// POST /api/service-usage   { bookingId, serviceId, quantity }
// Guests may only request for their own booking; front desk / service staff may log for any booking.
const logServiceUsage = asyncHandler(async (req, res) => {
  const { bookingId, serviceId, quantity } = req.body;
  if (!bookingId || !serviceId || !quantity) {
    return res.status(400).json({ error: 'bookingId, serviceId and quantity are required.' });
  }

  if (req.user.type === 'guest') {
    const [[booking]] = await pool.execute(`SELECT GuestID FROM BOOKING WHERE BookingID = ?`, [bookingId]);
    if (!booking || booking.GuestID !== req.user.id) {
      return res.status(403).json({ error: 'You can only request services for your own booking.' });
    }
  }

  try {
    await pool.execute(`CALL sp_log_service_usage(?, ?, ?)`, [bookingId, serviceId, quantity]);
    res.status(201).json({ bookingId, serviceId, quantity });
  } catch (err) {
    if (err.sqlState === '45000') return res.status(409).json({ error: err.sqlMessage });
    throw err;
  }
});

// GET /api/service-usage/:bookingId
const listServiceUsageForBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const [rows] = await pool.execute(
    `SELECT su.*, sc.ServiceName
     FROM SERVICE_USAGE su JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
     WHERE su.BookingID = ? ORDER BY su.UsageDate DESC`,
    [bookingId]
  );
  res.json(rows);
});

module.exports = { listServices, createService, updateService, logServiceUsage, listServiceUsageForBooking };
