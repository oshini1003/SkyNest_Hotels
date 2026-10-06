const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { positiveInteger, canLogServiceUsage, validateServiceUsage } = require('../utils/serviceUsageValidation');

function serviceUsageConflict(err, res) {
  if (err.sqlState === '45000') {
    res.status(409).json({ error: err.sqlMessage || 'The service cannot be recorded in the current booking state.' });
    return true;
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code) || [1205, 1213].includes(err.errno)) {
    res.status(409).json({ error: 'Another booking action is in progress. Refresh the booking before trying again.' });
    return true;
  }
  if (err.sqlState === '22003' || ['ER_WARN_DATA_OUT_OF_RANGE', 'ER_DATA_OUT_OF_RANGE'].includes(err.code)
      || [1264, 1690].includes(err.errno)) {
    res.status(400).json({ error: 'This quantity would exceed the supported service or bill amount. Enter a smaller quantity.' });
    return true;
  }
  if (['ER_CHECK_CONSTRAINT_VIOLATED', 'ER_CONSTRAINT_FAILED'].includes(err.code) || [3819, 4025].includes(err.errno)) {
    res.status(409).json({ error: 'The service could not be recorded with these values. Refresh the booking and service catalogue.' });
    return true;
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
    res.status(409).json({ error: 'The booking or service is no longer available. Refresh before trying again.' });
    return true;
  }
  return false;
}

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
  if (!canLogServiceUsage(req.user)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const parsed = validateServiceUsage(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bookingId, serviceId, quantity } = parsed.value;
  const own = req.user.type === 'guest';
  try {
    const [[booking]] = await pool.execute(
      `SELECT BookingStatus FROM BOOKING WHERE BookingID = ?${own ? ' AND GuestID = ?' : ''}`,
      own ? [bookingId, positiveInteger(req.user.id)] : [bookingId]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.BookingStatus !== 'Checked-In') {
      return res.status(409).json({ error: 'Services can only be logged against a Checked-In booking.' });
    }
    // The procedure locks and rechecks the booking, captures the current price,
    // and atomically inserts usage and recalculates the bill in its transaction.
    // Do not wrap it in another transaction or retry a failed request here.
    // Exactly one authenticated actor reaches SQL. Ignore browser actor fields;
    // the procedure rechecks guest ownership under the booking lock.
    await pool.execute(`CALL sp_log_service_usage(?, ?, ?, ?, ?)`, [
      bookingId, serviceId, quantity,
      own ? null : positiveInteger(req.user.id),
      own ? positiveInteger(req.user.id) : null,
    ]);
    res.status(201).json({ bookingId, serviceId, quantity });
  } catch (err) {
    if (serviceUsageConflict(err, res)) return;
    throw err;
  }
});

// GET /api/service-usage/:bookingId
const listServiceUsageForBooking = asyncHandler(async (req, res) => {
  const rawBookingId = req.params.bookingId;
  if (typeof rawBookingId !== 'string' || !/^[1-9]\d*$/.test(rawBookingId)
      || Number(rawBookingId) > 2147483647) {
    return res.status(400).json({ error: 'bookingId must be a positive whole number no greater than 2147483647.' });
  }
  const bookingId = Number(rawBookingId);

  if (req.user.type === 'guest') {
    const [[booking]] = await pool.execute(
      `SELECT BookingID FROM BOOKING WHERE BookingID = ? AND GuestID = ?`,
      [bookingId, req.user.id]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  }

  const [rows] = await pool.execute(
    `SELECT su.*, sc.ServiceName, (su.Quantity * su.PriceAtUsage) AS LineTotal,
            DATE_FORMAT(su.UsageDate, '%Y-%m-%d %H:%i:%s') AS UsageDateDisplay
     FROM SERVICE_USAGE su JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
     WHERE su.BookingID = ? ORDER BY su.UsageDate DESC, su.UsageID DESC`,
    [bookingId]
  );
  res.json(rows);
});

module.exports = { listServices, createService, updateService, logServiceUsage, listServiceUsageForBooking };
