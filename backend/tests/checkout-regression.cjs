const assert = require('node:assert/strict');

// Controller boundary tests use a fake pool and do not change real bookings.
// Stored-procedure locking, rollback, payment guards and room release need MySQL.
const calls = [];
let db;
const execute = async (sql, params = []) => {
  calls.push({ sql, params });
  if (!db) throw new Error('Unexpected database access');
  return db(sql, params);
};
const forbiddenTransaction = () => {
  throw new Error('Checkout must let sp_check_out own its transaction.');
};
require.cache[require.resolve('../config/db')] = { exports: {
  execute, query: execute, getConnection: forbiddenTransaction,
  beginTransaction: forbiddenTransaction, commit: forbiddenTransaction, rollback: forbiddenTransaction,
} };
const { checkOut } = require('../controllers/bookingController');
const staff = { type: 'staff', id: 3, role: 'Receptionist' };
const bill = { BillID: 8, BookingID: 25, RoomCharges: '100.00', ServiceCharges: '25.00',
  TotalAmount: '125.00', BillStatus: 'Paid' };
const preflightSql = 'SELECT BookingStatus FROM BOOKING WHERE BookingID = ?';
const procedureSql = 'CALL sp_check_out(?, ?)';
const billSql = 'SELECT bill.* FROM BILL bill JOIN BOOKING b ON b.BookingID = bill.BookingID WHERE b.BookingID = ?';
const sqlKind = sql => sql.startsWith(preflightSql) ? preflightSql : sql.startsWith(billSql) ? billSql : sql;

function reset(handler) { calls.length = 0; db = handler; }
function invoke(values = {}) {
  return new Promise((resolve, reject) => {
    const req = { user: staff, params: { id: '25' }, body: {}, ...values };
    if (req.user?.type === 'staff') req.staffScope = { staffId: req.user.id, role: req.user.role, branchId: 3, branchName: 'SkyNest Galle' };
    const res = { statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    checkOut(req, res, reject);
  });
}
function storedState(options = {}) {
  return async (sql, params) => {
    if (sql.startsWith(preflightSql)) {
      assert.equal(calls.length, 1, 'Booking existence/status is the first SQL operation.');
      assert.deepEqual(params, [25, 3, params[2], 3, ...(params[2] === 'Receptionist' ? [3] : [])]);
      assert.ok(['Admin', 'Manager', 'Receptionist'].includes(params[2]));
      assert.match(sql, /scope_staff\.StaffID = \?/);
      if (options.preflightError) throw options.preflightError;
      return [options.missing ? [] : [{ BookingStatus: options.status || 'Checked-In' }]];
    }
    if (sql === procedureSql) {
      assert.equal(calls.length, 2, 'No unlocked balance check precedes the authoritative procedure.');
      assert.deepEqual(params, [25, 3], 'StaffID comes from the authenticated identity.');
      if (options.procedureError) throw options.procedureError;
      return [[]];
    }
    assert.equal(sqlKind(sql), billSql, 'No extra writes, transaction statements or retries are allowed.');
    assert.match(sql, /scope_staff\.StaffID = \?/);
    assert.equal(calls.length, 3, 'The bill is read once after the procedure has committed.');
    assert.deepEqual(params, calls[0].params, 'Post-commit bill lookup preserves the same actor and branch scope.');
    if (options.billError) throw options.billError;
    return [options.missingBill ? [] : [bill]];
  };
}

(async () => {
  reset();
  for (const user of [undefined, null, {}, { type: 'guest', id: 4 },
    { type: 'guest', id: 4, role: 'Admin' }, { type: 'admin', id: 3, role: 'Admin' },
    { ...staff, role: 'ServiceStaff' }, { ...staff, role: 'Service Staff' },
    { ...staff, role: 'Housekeeping' }, { ...staff, role: 'Unknown' },
    { ...staff, role: undefined }, { ...staff, role: ['Admin'] },
    ...[undefined, null, 0, -1, 1.5, NaN, '01', '2147483648', ['3'], {}].map(id => ({ ...staff, id }))]) {
    assert.equal((await invoke({ user })).status, 403);
  }
  for (const id of ['', '0', '01', '-1', '1.5', '1e2', '+25', ' 25 ', '25 OR 1=1',
    ['25'], {}, null, undefined, '2147483648']) {
    assert.equal((await invoke({ params: { id } })).status, 400);
  }
  assert.equal(calls.length, 0, 'Invalid IDs and forbidden identities must not access SQL.');

  reset(storedState({ missing: true }));
  assert.deepEqual(await invoke(), { status: 404, data: { error: 'Booking not found.' } });
  assert.equal(calls.length, 1, 'Missing bookings never reach checkout or bill reads.');

  for (const status of ['Booked', 'Cancelled', 'Checked-Out', 'Unknown']) {
    reset(storedState({ status }));
    assert.deepEqual(await invoke(), { status: 409,
      data: { error: 'Only a Checked-In reservation can be checked out.' } });
    assert.equal(calls.length, 1, 'Only Checked-In bookings reach the procedure.');
  }

  for (const role of ['Receptionist', 'Manager', 'Admin']) {
    reset(storedState());
    assert.deepEqual(await invoke({ user: { ...staff, role },
      body: { staffId: 999, StaffID: 999, bookingId: 999, status: 'Cancelled', outstandingBalance: 0 } }),
    { status: 200, data: { bookingId: 25, status: 'Checked-Out', bill } });
    assert.deepEqual(calls.map(call => sqlKind(call.sql)), [preflightSql, procedureSql, billSql]);
    assert.ok(calls.every(call => !/START TRANSACTION|BEGIN|COMMIT|ROLLBACK/.test(call.sql)),
      'The procedure owns its transaction; the controller must never wrap it.');
  }

  // A payment or status change after preflight is decided by the procedure.
  for (const error of [
    { sqlState: '45000', sqlMessage: 'Cannot check out: outstanding balance must be paid.' },
    { sqlState: '45000', sqlMessage: 'Only a Checked-In booking can be checked out.' },
    { sqlState: '45000' }, { code: 'ER_LOCK_DEADLOCK' },
    { code: 'ER_LOCK_WAIT_TIMEOUT' }, { code: 'ER_NO_REFERENCED_ROW_2' },
  ]) {
    reset(storedState({ procedureError: error }));
    const result = await invoke();
    assert.equal(result.status, 409);
    if (error.sqlMessage) assert.equal(result.data.error, error.sqlMessage);
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      assert.equal(result.data.error, 'Another booking action is in progress. Please refresh and try again.');
    }
    assert.deepEqual(calls.map(call => sqlKind(call.sql)), [preflightSql, procedureSql],
      'Blocked checkout reads no bill, retries nothing and performs no controller writes.');
  }

  for (const stage of ['preflightError', 'procedureError']) {
    const error = new Error(`Generic SQL failure at ${stage}`);
    reset(storedState({ [stage]: error }));
    await assert.rejects(invoke(), caught => caught === error, 'Unexpected SQL errors go to the central error handler.');
    assert.equal(calls.length, stage === 'preflightError' ? 1 : 2);
  }

  // A successful CALL means checkout committed, even if reading its bill fails.
  // Return known success so the client refreshes instead of retrying checkout.
  for (const error of [new Error('Post-commit bill read failed'), { code: 'ER_LOCK_DEADLOCK' },
    { code: 'ER_LOCK_WAIT_TIMEOUT' }, { sqlState: '45000', sqlMessage: 'Read failed after commit' }]) {
    reset(storedState({ billError: error }));
    assert.deepEqual(await invoke(), { status: 200,
      data: { bookingId: 25, status: 'Checked-Out', bill: null, refreshRequired: true } });
    assert.deepEqual(calls.map(call => sqlKind(call.sql)), [preflightSql, procedureSql, billSql],
      'Post-commit response failure must never trigger checkout again.');
  }
  reset(storedState({ missingBill: true }));
  assert.deepEqual(await invoke(), { status: 200,
    data: { bookingId: 25, status: 'Checked-Out', bill: null, refreshRequired: true } });
  assert.deepEqual(calls.map(call => sqlKind(call.sql)), [preflightSql, procedureSql, billSql],
    'A missing post-commit bill also preserves known success without rerunning checkout.');

  // Procedure authorization is rechecked under locks. Never expose its SQL message.
  for (const [sqlState, status, message] of [
    ['45003', 404, 'Booking not found.'],
    ['45004', 403, 'You do not have permission to perform this action.'],
  ]) {
    reset(storedState({ procedureError: { sqlState, sqlMessage: 'private cross-branch details' } }));
    assert.deepEqual(await invoke(), { status, data: { error: message } });
    assert.equal(calls.length, 2, 'Scope denial ends after one CALL and never retries or reads the bill.');
  }
  console.log('PASS: checkout role/ID validation, missing/status preflight, authenticated StaffID, procedure-owned payment/state conflicts and transaction, success contract, no retries, and known-commit bill-read fallback (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
