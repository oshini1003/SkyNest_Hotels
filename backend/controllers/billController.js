const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/bookings/:bookingId/bill  - itemised live bill (room + service charges, paid, balance)
const getBill = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (req.user.type === 'guest') {
    const [[booking]] = await pool.execute(`SELECT GuestID FROM BOOKING WHERE BookingID = ?`, [bookingId]);
    if (!booking || booking.GuestID !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own bill.' });
    }
  }

  const [[roomCharges]] = await pool.query(`SELECT fn_calculate_room_charges(?) AS RoomCharges`, [bookingId]);
  const [[serviceCharges]] = await pool.query(`SELECT fn_calculate_service_charges(?) AS ServiceCharges`, [bookingId]);
  const [[balance]] = await pool.query(`SELECT fn_calculate_outstanding_balance(?) AS OutstandingBalance`, [bookingId]);
  const [[bill]] = await pool.execute(`SELECT * FROM BILL WHERE BookingID = ?`, [bookingId]);
  const [payments] = await pool.execute(`SELECT * FROM PAYMENT WHERE BookingID = ? ORDER BY PaymentDate`, [bookingId]);
  const [serviceUsage] = await pool.execute(
    `SELECT su.*, sc.ServiceName FROM SERVICE_USAGE su
     JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID WHERE su.BookingID = ?`,
    [bookingId]
  );

  res.json({
    bookingId: Number(bookingId),
    roomCharges: roomCharges.RoomCharges,
    serviceCharges: serviceCharges.ServiceCharges,
    totalAmount: roomCharges.RoomCharges + serviceCharges.ServiceCharges,
    outstandingBalance: balance.OutstandingBalance,
    bill: bill || null,
    payments,
    serviceUsage,
  });
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
