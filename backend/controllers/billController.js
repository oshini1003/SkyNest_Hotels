const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { canProcessPayment, validatePayment } = require('../utils/paymentValidation');

const paymentConflictMessages = new Set([
  'Payments require a Checked-In booking.',
  'No bill exists yet for this booking (guest must be Checked-In first).',
  'Payment amount must be > 0 and cannot exceed the outstanding balance.',
  'Choose Cash, Card or Bank Transfer.',
]);

function paymentConflict(err, res) {
  if (err.sqlState === '45000') {
    const error = paymentConflictMessages.has(err.sqlMessage)
      ? err.sqlMessage : 'The payment cannot be recorded in the current booking state.';
    res.status(409).json({ error });
    return true;
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code) || [1205, 1213].includes(err.errno)) {
    res.status(409).json({ error: 'Another booking action is in progress. Refresh the bill before trying again.' });
    return true;
  }
  if (err.sqlState === '22003' || ['ER_WARN_DATA_OUT_OF_RANGE', 'ER_DATA_OUT_OF_RANGE'].includes(err.code)
      || [1264, 1690].includes(err.errno)) {
    res.status(400).json({ error: 'This payment exceeds the supported payment or bill amount.' });
    return true;
  }
  return false;
}

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
        ? 'SELECT BookingID, BookingStatus FROM BOOKING WHERE BookingID = ? AND GuestID = ?'
        : 'SELECT BookingID, BookingStatus FROM BOOKING WHERE BookingID = ?',
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
      `SELECT p.*, DATE_FORMAT(p.PaymentDate, '%Y-%m-%d %H:%i:%s') AS PaymentDateDisplay
       FROM PAYMENT p WHERE p.BookingID = ? ORDER BY p.PaymentDate, p.PaymentID`, [bookingId]
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
      bookingStatus: booking.BookingStatus,
      roomCharges: asAmount(roomCents),
      serviceCharges: asAmount(serviceCents),
      totalAmount: asAmount(totalCents),
      paidAmount: asAmount(paidCents),
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

// POST /api/payments   { bookingId, amount, paymentMethod }  (Front Desk / Manager / Admin)
const processPayment = asyncHandler(async (req, res) => {
  if (!canProcessPayment(req.user)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const parsed = validatePayment(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { bookingId, amount, paymentMethod } = parsed.value;
  try {
    const [[booking]] = await pool.execute('SELECT BookingStatus FROM BOOKING WHERE BookingID = ?', [bookingId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.BookingStatus !== 'Checked-In') {
      return res.status(409).json({ error: 'Payments require a Checked-In booking.' });
    }
    // The procedure owns its transaction, locks the booking first, rechecks
    // status and balance, and atomically inserts payment/update bill status.
    // Never wrap this call in another transaction or automatically retry it.
    await pool.execute(`CALL sp_process_payment(?, ?, ?)`, [bookingId, amount, paymentMethod]);
  } catch (err) {
    if (paymentConflict(err, res)) return;
    throw err;
  }

  // CALL completed successfully, so the payment is committed even if this
  // separate live-balance read fails. Preserve that acknowledgement and ask
  // the client to reconcile the bill; a false failure could invite duplicates.
  const result = { bookingId, amount: Number(amount), outstandingBalance: null };
  try {
    const [[balance]] = await pool.query(`SELECT fn_calculate_outstanding_balance(?) AS OutstandingBalance`, [bookingId]);
    const rawBalance = balance?.OutstandingBalance;
    if (!['string', 'number'].includes(typeof rawBalance)
        || !/^-?\d+(?:\.\d{1,2})?$/.test(String(rawBalance))
        || !Number.isFinite(Number(rawBalance))) {
      throw new Error('Invalid outstanding balance returned by database.');
    }
    result.outstandingBalance = Number(rawBalance);
  } catch (_) {
    result.refreshRequired = true;
  }
  res.status(201).json(result);
});

module.exports = { getBill, processPayment };
