const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/bookings/:bookingId/bill  - itemised live bill (room + service charges, paid, balance)
const getBill = asyncHandler(async (req, res) => {
  const rawBookingId = req.params.bookingId;
  if (typeof rawBookingId !== 'string' || !/^[1-9]\d*$/.test(rawBookingId)
      || Number(rawBookingId) > 2147483647) {
    return res.status(400).json({ error: 'bookingId must be a positive whole number no greater than 2147483647.' });
  }
  const bookingId = Number(rawBookingId);

  if (!req.user || !['guest', 'staff'].includes(req.user.type)
      || !Number.isInteger(req.user.id) || req.user.id < 1 || req.user.id > 2147483647) {
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }

  // DECIMAL values may be numbers or strings; add/subtract whole cents so a
  // fully paid bill does not acquire a floating-point remainder.
  const toCents = (value) => {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) throw new Error('Invalid monetary amount returned by database.');
    const amount = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
    return match[1] ? -amount : amount;
  };
  const asAmount = (cents) => Number(cents) / 100;

  const connection = await pool.getConnection();
  let result;
  try {
    // All reads, including stored functions, must observe the same committed
    // state while service and payment procedures update the live bill.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

    const [[booking]] = await connection.execute(
      req.user.type === 'guest'
        ? 'SELECT BookingID FROM BOOKING WHERE BookingID = ? AND GuestID = ?'
        : 'SELECT BookingID FROM BOOKING WHERE BookingID = ?',
      req.user.type === 'guest' ? [bookingId, req.user.id] : [bookingId]
    );
    if (!booking) {
      await connection.commit();
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const [[bill]] = await connection.execute('SELECT * FROM BILL WHERE BookingID = ?', [bookingId]);
    let charges = bill;
    if (!charges) {
      [[charges]] = await connection.query(
        `SELECT fn_calculate_room_charges(?) AS RoomCharges,
                fn_calculate_service_charges(?) AS ServiceCharges`,
        [bookingId, bookingId]
      );
    }
    const [payments] = await connection.execute(
      'SELECT * FROM PAYMENT WHERE BookingID = ? ORDER BY PaymentDate, PaymentID', [bookingId]
    );
    const [serviceUsage] = await connection.execute(
      `SELECT su.*, sc.ServiceName, su.Quantity * su.PriceAtUsage AS LineTotal,
              DATE_FORMAT(su.UsageDate, '%Y-%m-%d %H:%i:%s') AS UsageDateDisplay
       FROM SERVICE_USAGE su JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
       WHERE su.BookingID = ? ORDER BY su.UsageDate DESC, su.UsageID DESC`,
      [bookingId]
    );

    const roomCents = toCents(charges.RoomCharges);
    const serviceCents = toCents(charges.ServiceCharges);
    // Match fn_calculate_outstanding_balance: a stored bill is authoritative,
    // including after catalogue prices change; otherwise show the estimate.
    const totalCents = bill ? toCents(bill.TotalAmount) : roomCents + serviceCents;
    const paidCents = payments.reduce((sum, payment) => sum + toCents(payment.Amount), 0n);
    result = {
      bookingId,
      roomCharges: asAmount(roomCents),
      serviceCharges: asAmount(serviceCents),
      totalAmount: asAmount(totalCents),
      outstandingBalance: asAmount(totalCents - paidCents),
      bill: bill || null,
      payments,
      serviceUsage,
    };
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (_) { /* Preserve the original read error. */ }
    throw err;
  } finally {
    connection.release();
  }
  res.json(result);
});

// POST /api/payments   { bookingId, amount, paymentMethod }  (Front Desk / Staff)
const processPayment = asyncHandler(async (req, res) => {
  const { bookingId, amount, paymentMethod } = req.body;
  if (!bookingId || !amount || !paymentMethod) {
    return res.status(400).json({ error: 'bookingId, amount and paymentMethod are required.' });
  }
  try {
    await pool.execute(`CALL sp_process_payment(?, ?, ?)`, [bookingId, amount, paymentMethod]);
    const [[balance]] = await pool.query(`SELECT fn_calculate_outstanding_balance(?) AS OutstandingBalance`, [bookingId]);
    res.status(201).json({ bookingId, amount, outstandingBalance: balance.OutstandingBalance });
  } catch (err) {
    if (err.sqlState === '45000') return res.status(409).json({ error: err.sqlMessage });
    throw err;
  }
});

module.exports = { getBill, processPayment };
