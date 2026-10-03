const assert = require('node:assert/strict');
const path = require('node:path');
const { positiveBookingId, paymentAmount, validatePayment } = require('../utils/paymentValidation');

// No live database is required. The procedure owns locking/atomicity; these
// checks prove the controller's input, authorization and acknowledgement contract.
const calls = [];
const bookings = new Map([
  [11, { BookingStatus: 'Checked-In' }],
  [31, { BookingStatus: 'Booked' }],
  [32, { BookingStatus: 'Checked-Out' }],
  [33, { BookingStatus: 'Cancelled' }],
  [2147483647, { BookingStatus: 'Checked-In' }],
]);
let lookupError;
let procedureError;
let balanceError;
let balanceValue = '75.00';
const pool = {
  async execute(sql, params) {
    calls.push({ sql, params });
    if (sql === 'SELECT BookingStatus FROM BOOKING WHERE BookingID = ?') {
      assert.equal(params.length, 1);
      if (lookupError) throw lookupError;
      return [bookings.has(params[0]) ? [bookings.get(params[0])] : []];
    }
    assert.equal(sql, 'CALL sp_process_payment(?, ?, ?)');
    assert.equal(params.length, 3);
    assert.equal(positiveBookingId(params[0]), params[0]);
    assert.equal(typeof params[1], 'string', 'SQL must receive the exact decimal string.');
    assert.match(params[1], /^\d+\.\d{2}$/);
    assert.equal(paymentAmount(params[1]), params[1]);
    assert.ok(['Cash', 'Card', 'Bank Transfer'].includes(params[2]));
    if (procedureError) throw procedureError;
    // A CALL driver's insertId is not an authoritative payment ID.
    return [{ affectedRows: 1, insertId: 999 }];
  },
  async query(sql, params) {
    calls.push({ sql, params });
    assert.equal(sql, 'SELECT fn_calculate_outstanding_balance(?) AS OutstandingBalance');
    assert.equal(params.length, 1);
    if (balanceError) throw balanceError;
    return [[{ OutstandingBalance: balanceValue }]];
  },
  getConnection() { throw new Error('The procedure owns the transaction.'); },
  beginTransaction() { throw new Error('The procedure owns the transaction.'); },
  commit() { throw new Error('The procedure owns the transaction.'); },
  rollback() { throw new Error('The procedure owns the transaction.'); },
};
require.cache[require.resolve(path.join(__dirname, '../config/db'))] = { exports: pool };
const { processPayment } = require('../controllers/billController');
const staff = { type: 'staff', id: 4, role: 'Receptionist' };
const validBody = { bookingId: 11, amount: '25.00', paymentMethod: 'Cash' };
function post(body = validBody, user) {
  if (arguments.length < 2) user = staff;
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    processPayment({ body, user }, res, reject);
  });
}
function reset() {
  calls.length = 0;
  lookupError = procedureError = balanceError = undefined;
  balanceValue = '75.00';
}

(async () => {
  const invalidIds = [undefined, null, '', '0', '-1', '01', '+1', '1.0', '1e2', ' 1', '1 ', '1\n',
    '2147483648', '9'.repeat(100), '11 OR 1=1', '0x10', 0, -1, 1.5, 2147483648,
    NaN, Infinity, -Infinity, true, false, [], [11], {}, new Number(11)];
  for (const bookingId of invalidIds) {
    assert.equal(positiveBookingId(bookingId), null);
    assert.equal((await post({ ...validBody, bookingId })).status, 400);
  }
  const invalidAmounts = [undefined, null, '', '0', '0.00', '-1', '-0.01', '+1', '.01', '1.',
    '0.001', '1.001', '1.010', '99.999', '99999999.999', '100000000', '100000000.00',
    '1e2', '1E2', '1e-2', ' 1', '1 ', '1\n', '0x10', 'NaN', 'Infinity', '25 OR 1=1',
    '1,000.00', '9'.repeat(100), 0, -0, -1, 0.001, 1.001, 100000000,
    0.1 + 0.2, NaN, Infinity, -Infinity, true, false, [], [25], {}, new Number(25)];
  for (const amount of invalidAmounts) {
    assert.equal(paymentAmount(amount), null, `Invalid amount ${String(amount)}`);
    assert.equal((await post({ ...validBody, amount })).status, 400);
  }
  for (const paymentMethod of [undefined, null, '', 'cash', 'Cash ', 'BankTransfer', 'Crypto',
    true, 1, ['Cash'], {}, new String('Cash')]) {
    assert.equal((await post({ ...validBody, paymentMethod })).status, 400);
  }
  for (const body of [null, '', 1, true, [], {}, Object.create(validBody)]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.ok(validatePayment(undefined).error);
  assert.equal(calls.length, 0, 'Invalid requests must stop before SQL.');

  for (const user of [undefined, null, {}, { type: 'guest', id: 4 }, { type: 'guest', id: 4, role: 'Admin' },
    { type: 'staff', id: 4 }, { type: 'staff', id: 4, role: 'ServiceStaff' },
    { type: 'staff', id: 4, role: 'admin' }, { type: 'staff', id: 4, role: ['Admin'] },
    { type: 'Admin', id: 4, role: 'Admin' }]) {
    assert.equal((await post(validBody, user)).status, 403);
  }
  for (const id of [...invalidIds, '4']) {
    assert.equal((await post(validBody, { ...staff, id })).status, 403);
  }
  assert.equal(calls.length, 0, 'Only authorized token identities may reach SQL.');
  assert.equal((await post({ ...validBody, user: staff, role: 'Admin', staffId: 4 }, null)).status, 403);
  assert.equal(calls.length, 0, 'Request-body identity cannot authorize a payment.');

  for (const [amount, normalized] of [
    [0.01, '0.01'], ['0.01', '0.01'], ['0.1', '0.10'], [0.1, '0.10'], [1, '1.00'],
    ['1', '1.00'], ['1.2', '1.20'], ['0001.20', '1.20'], [25.99, '25.99'],
    ['99999999.99', '99999999.99'], [99999999.99, '99999999.99'],
  ]) {
    reset();
    assert.equal(paymentAmount(amount), normalized);
    assert.deepEqual(await post({ ...validBody, bookingId: '11', amount }), {
      status: 201, data: { bookingId: 11, amount: Number(normalized), outstandingBalance: 75 },
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].params, [11]);
    assert.deepEqual(calls[1].params, [11, normalized, 'Cash']);
    assert.deepEqual(calls[2].params, [11]);
  }
  for (const role of ['Admin', 'Manager', 'Receptionist']) {
    for (const paymentMethod of ['Cash', 'Card', 'Bank Transfer']) {
      reset();
      assert.equal((await post({ ...validBody, paymentMethod }, { ...staff, role })).status, 201);
      assert.deepEqual(calls[1].params, [11, '25.00', paymentMethod]);
    }
  }
  reset();
  assert.equal((await post({ ...validBody, bookingId: '2147483647' }, { ...staff, id: 2147483647 })).status, 201);
  assert.deepEqual(calls[1].params, [2147483647, '25.00', 'Cash']);

  reset();
  assert.deepEqual(await post({ ...validBody, bookingId: 404 }), {
    status: 404, data: { error: 'Booking not found.' },
  });
  assert.equal(calls.length, 1);
  for (const bookingId of [31, 32, 33]) {
    reset();
    assert.deepEqual(await post({ ...validBody, bookingId }), {
      status: 409, data: { error: 'Payments require a Checked-In booking.' },
    });
    assert.equal(calls.length, 1, 'Ineligible bookings stop before CALL.');
  }
  reset();
  const response = await post({ ...validBody, staffId: 999, StaffID: 999, guestId: 999,
    role: 'Admin', BillID: 999, PaymentID: 999, PaymentType: 'Full', paymentType: 'Full',
    BillStatus: 'Paid', totalAmount: 0, outstandingBalance: 0, paidAmount: 100000 });
  assert.deepEqual(response, { status: 201, data: { bookingId: 11, amount: 25, outstandingBalance: 75 } });
  assert.deepEqual(calls[1].params, [11, '25.00', 'Cash']);
  assert.ok(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|START TRANSACTION|COMMIT|ROLLBACK)\b/.test(sql)));

  for (const sqlMessage of [
    'Payments require a Checked-In booking.',
    'No bill exists yet for this booking (guest must be Checked-In first).',
    'Payment amount must be > 0 and cannot exceed the outstanding balance.',
    'Choose Cash, Card or Bank Transfer.',
  ]) {
    reset();
    procedureError = { sqlState: '45000', sqlMessage };
    assert.deepEqual(await post(), { status: 409, data: { error: sqlMessage } });
    assert.equal(calls.length, 2, 'Locked state/overpayment checks are authoritative; never retry CALL.');
  }
  for (const sqlMessage of [undefined, 'private SQL or database details']) {
    reset();
    procedureError = { sqlState: '45000', sqlMessage };
    const result = await post();
    assert.equal(result.status, 409);
    assert.doesNotMatch(result.data.error, /private SQL/);
  }
  for (const [error, status] of [
    [{ code: 'ER_LOCK_DEADLOCK' }, 409], [{ code: 'ER_LOCK_WAIT_TIMEOUT' }, 409],
    [{ errno: 1205 }, 409], [{ errno: 1213 }, 409],
    [{ code: 'ER_WARN_DATA_OUT_OF_RANGE' }, 400], [{ code: 'ER_DATA_OUT_OF_RANGE' }, 400],
    [{ sqlState: '22003' }, 400], [{ errno: 1264 }, 400], [{ errno: 1690 }, 400],
  ]) {
    reset();
    procedureError = { ...error, sqlMessage: 'private SQL or database details' };
    const result = await post();
    assert.equal(result.status, status);
    assert.doesNotMatch(result.data.error, /private SQL/);
    assert.equal(calls.length, 2);
  }
  reset();
  lookupError = { code: 'ER_LOCK_WAIT_TIMEOUT' };
  assert.equal((await post()).status, 409);
  assert.equal(calls.length, 1);
  reset();
  procedureError = Object.assign(new Error('Connection lost during CALL'), { code: 'PROTOCOL_CONNECTION_LOST' });
  await assert.rejects(post(), error => error === procedureError);
  assert.equal(calls.length, 2, 'An uncertain CALL outcome must not be retried or acknowledged as success.');

  // A successful CALL is a durable acknowledgement. Even a normally controlled
  // balance-read error cannot turn a committed payment into a false failure.
  for (const error of [new Error('Read connection lost'), { code: 'ER_LOCK_DEADLOCK' },
    { sqlState: '45000', sqlMessage: 'private SQL' }, { sqlState: '22003' }]) {
    reset();
    balanceError = error;
    assert.deepEqual(await post(), {
      status: 201, data: { bookingId: 11, amount: 25, outstandingBalance: null, refreshRequired: true },
    });
    assert.equal(calls.length, 3, 'Only the bill should be refreshed; do not replay the payment.');
  }
  for (const invalidBalance of [undefined, null, NaN, Infinity, 'broken', {}, [], true]) {
    reset();
    balanceValue = invalidBalance;
    const result = await post();
    assert.equal(result.status, 201);
    assert.equal(result.data.outstandingBalance, null);
    assert.equal(result.data.refreshRequired, true);
  }
  reset();
  balanceValue = '0.00';
  assert.deepEqual(await post(), { status: 201, data: { bookingId: 11, amount: 25, outstandingBalance: 0 } });
  console.log('PASS: strict payment amounts/IDs and token roles; exact decimal SQL; missing/state checks; procedure conflicts; safe errors; server-owned fields; no outer transaction/retry; committed-payment acknowledgement and uncertain-CALL forwarding.');
})().catch(error => { console.error(error); process.exitCode = 1; });
