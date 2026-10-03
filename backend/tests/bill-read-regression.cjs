const assert = require('node:assert/strict');
const path = require('node:path');

// Isolated controller coverage. Real MySQL snapshot/concurrency checks require
// a configured database; the mock rejects all reads outside one connection.
const root = path.resolve(__dirname, '..');
let activeConnection;
let acquisitions = 0;
let acquireError;
const pool = {
  async getConnection() {
    acquisitions += 1;
    if (acquireError) throw acquireError;
    return activeConnection;
  },
  execute() { throw new Error('Bill reads must use their acquired connection.'); },
  query() { throw new Error('Bill reads must use their acquired connection.'); },
};
require.cache[require.resolve(path.join(root, 'config/db'))] = { exports: pool };
const { getBill } = require(path.join(root, 'controllers/billController'));

function invoke(bookingId, user) {
  if (arguments.length === 0) bookingId = '12';
  if (arguments.length < 2) user = { type: 'guest', id: 7 };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    getBill({ params: { bookingId }, user }, res, reject);
  });
}

function connection(options = {}) {
  const events = [];
  let snapshot;
  let started = false;
  const current = {
    booking: options.booking === undefined ? { BookingID: 12, GuestID: 7 } : options.booking,
    bill: options.bill === undefined ? null : options.bill,
    estimate: options.estimate || { RoomCharges: 0.1, ServiceCharges: 0.2 },
    payments: options.payments || [],
    serviceUsage: options.serviceUsage || [],
  };
  const conn = {
    events,
    async query(sql, values) { return read(sql, values); },
    async execute(sql, values) { return read(sql, values); },
    async commit() {
      events.push('commit');
      if (options.fail === 'commit') throw options.error;
      started = false;
    },
    async rollback() {
      events.push('rollback');
      started = false;
      if (options.rollbackError) throw options.rollbackError;
    },
    release() { events.push('release'); },
  };
  async function read(sql, values) {
    events.push({ sql, values });
    assert.doesNotMatch(sql, /\b(CALL|INSERT|UPDATE|DELETE|FOR UPDATE|LOCK IN SHARE MODE)\b/i);
    if (options.fail && typeof options.fail === 'function' && options.fail(sql)) throw options.error;
    if (sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') {
      assert.equal(events.length, 1);
      return [[]];
    }
    if (sql === 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY') {
      assert.equal(events.length, 2);
      started = true;
      snapshot = structuredClone(current);
      return [[]];
    }
    assert.ok(started, 'Every data read must run within the snapshot.');
    if (sql.startsWith('SELECT BookingID FROM BOOKING')) {
      assert.equal(events.length, 3, 'Booking permission check must be the first data read.');
      const booking = snapshot.booking;
      const visible = booking && booking.BookingID === values[0]
        && (values.length === 1 || booking.GuestID === values[1]);
      if (options.afterBookingRead) options.afterBookingRead(current);
      return [visible ? [{ BookingID: booking.BookingID }] : []];
    }
    if (sql.startsWith('SELECT * FROM BILL')) return [snapshot.bill ? [snapshot.bill] : []];
    if (sql.includes('fn_calculate_room_charges')) {
      assert.match(sql, /fn_calculate_service_charges\(\?\)/);
      assert.deepEqual(values, [snapshot.booking.BookingID, snapshot.booking.BookingID]);
      return [[snapshot.estimate]];
    }
    if (sql.startsWith('SELECT * FROM PAYMENT')) {
      assert.match(sql, /ORDER BY PaymentDate, PaymentID$/);
      return [snapshot.payments];
    }
    if (sql.includes('FROM SERVICE_USAGE su')) {
      assert.match(sql, /su\.Quantity \* su\.PriceAtUsage AS LineTotal/);
      assert.doesNotMatch(sql, /UnitPrice|IsActive/);
      assert.match(sql, /DATE_FORMAT\(su\.UsageDate, '%Y-%m-%d %H:%i:%s'\) AS UsageDateDisplay/);
      assert.match(sql, /ORDER BY su\.UsageDate DESC, su\.UsageID DESC$/);
      return [snapshot.serviceUsage];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  activeConnection = conn;
  return conn;
}

const lifecycle = (conn) => conn.events.filter(event => typeof event === 'string');
const dataReads = (conn) => conn.events.filter(event => event.sql?.startsWith('SELECT'));

(async () => {
  for (const value of ['0', '-1', '01', '+1', '1.0', '1e2', ' 12', '12 ', '12x', '2147483648',
    '9'.repeat(100), '12 OR 1=1', '', null, undefined, 12, ['12'], {}]) {
    const count = acquisitions;
    assert.equal((await invoke(value)).status, 400, `Invalid ID ${String(value)}`);
    assert.equal(acquisitions, count, 'Invalid IDs must not acquire a connection.');
  }

  for (const user of [undefined, null, {}, { type: 'admin', id: 7 }, { type: 'guest', id: '7' },
    { type: 'staff', id: 0 }, { type: 'staff', id: -1 }, { type: 'guest', id: 1.5 },
    { type: 'staff', id: 2147483648 }, { type: 'guest', id: NaN }]) {
    const count = acquisitions;
    assert.equal((await invoke('12', user)).status, 401);
    assert.equal(acquisitions, count, 'Invalid identities must be rejected before SQL.');
  }

  for (const scenario of [
    { booking: null, user: { type: 'guest', id: 7 } },
    { booking: { BookingID: 12, GuestID: 8 }, user: { type: 'guest', id: 7 } },
    { booking: null, user: { type: 'staff', id: 3 } },
  ]) {
    const conn = connection(scenario);
    assert.deepEqual(await invoke('12', scenario.user), { status: 404, data: { error: 'Booking not found.' } });
    assert.equal(dataReads(conn).length, 1, 'No bill information may be read for a missing/foreign booking.');
    const first = dataReads(conn)[0];
    if (scenario.user.type === 'guest') {
      assert.match(first.sql, /BookingID = \? AND GuestID = \?$/);
      assert.deepEqual(first.values, [12, 7]);
    } else {
      assert.deepEqual(first.values, [12]);
    }
    assert.deepEqual(lifecycle(conn), ['commit', 'release']);
  }

  let conn = connection();
  let response = await invoke();
  assert.deepEqual(response, {
    status: 200,
    data: { bookingId: 12, roomCharges: 0.1, serviceCharges: 0.2, totalAmount: 0.3,
      outstandingBalance: 0.3, bill: null, payments: [], serviceUsage: [] },
  });
  assert.equal(dataReads(conn).filter(event => event.sql.includes('fn_calculate_')).length, 1);
  assert.deepEqual(lifecycle(conn), ['commit', 'release']);

  const bill = { BillID: 23, BookingID: 12, RoomCharges: '12.01', ServiceCharges: '59.97',
    TotalAmount: '71.98', BillStatus: 'Partially Paid' };
  const payments = [{ PaymentID: 1, Amount: '12.01' }, { PaymentID: 2, Amount: 0.1 }, { PaymentID: 3, Amount: 0.19 }];
  const serviceUsage = [{ UsageID: 4, ServiceName: 'Historical service', Quantity: 3,
    PriceAtUsage: '19.99', LineTotal: '59.97', UsageDateDisplay: '2026-10-02 23:59:59' }];
  conn = connection({ bill, payments, serviceUsage, estimate: { RoomCharges: 100, ServiceCharges: 500 } });
  response = await invoke('12', { type: 'staff', id: 3, role: 'Service Staff' });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.data), ['bookingId', 'roomCharges', 'serviceCharges', 'totalAmount',
    'outstandingBalance', 'bill', 'payments', 'serviceUsage']);
  assert.equal(response.data.roomCharges, 12.01);
  assert.equal(response.data.serviceCharges, 59.97);
  assert.equal(response.data.totalAmount, 71.98);
  assert.equal(response.data.outstandingBalance, 59.68);
  assert.deepEqual(response.data.bill, bill);
  assert.deepEqual(response.data.payments, payments);
  assert.deepEqual(response.data.serviceUsage, serviceUsage);
  assert.ok(!conn.events.some(event => event.sql?.includes('fn_calculate_')), 'Stored charges must not be recalculated.');
  assert.deepEqual(lifecycle(conn), ['commit', 'release']);

  for (const bookingStatus of ['Booked', 'Checked-In', 'Checked-Out', 'Cancelled']) {
    conn = connection({ booking: { BookingID: 12, GuestID: 7, BookingStatus: bookingStatus },
      bill: { ...bill, RoomCharges: 0.1, ServiceCharges: 0.2, TotalAmount: 0.3, BillStatus: 'Paid' },
      payments: [{ Amount: 0.1 }, { Amount: 0.2 }], serviceUsage });
    response = await invoke();
    assert.equal(response.data.outstandingBalance, 0);
    assert.deepEqual(response.data.serviceUsage, serviceUsage);
  }

  conn = connection({ booking: { BookingID: 2147483647, GuestID: 7 } });
  assert.equal((await invoke('2147483647')).data.bookingId, 2147483647);
  assert.deepEqual(dataReads(conn)[0].values, [2147483647, 7]);

  // A procedure committing after the first read must not mix its newer bill,
  // payments, or history into this response. The mock models a snapshot at START.
  conn = connection({ bill, payments, serviceUsage, afterBookingRead(current) {
    current.bill.TotalAmount = '999.99';
    current.payments.push({ PaymentID: 9, Amount: '99.99' });
    current.serviceUsage.push({ UsageID: 9, LineTotal: '99.99' });
  } });
  response = await invoke();
  assert.equal(response.data.totalAmount, 71.98);
  assert.equal(response.data.outstandingBalance, 59.68);
  assert.equal(response.data.payments.length, 3);
  assert.equal(response.data.serviceUsage.length, 1);

  for (const fail of [
    sql => sql.startsWith('SET TRANSACTION'),
    sql => sql.startsWith('START TRANSACTION'),
    sql => sql.startsWith('SELECT BookingID'),
    sql => sql.startsWith('SELECT * FROM BILL'),
    sql => sql.includes('fn_calculate_room_charges'),
    sql => sql.startsWith('SELECT * FROM PAYMENT'),
    sql => sql.includes('FROM SERVICE_USAGE'),
    'commit',
  ]) {
    const error = new Error('Database failure');
    conn = connection({ fail, error });
    await assert.rejects(invoke(), caught => caught === error);
    assert.deepEqual(lifecycle(conn), fail === 'commit'
      ? ['commit', 'rollback', 'release'] : ['rollback', 'release']);
  }

  const original = new Error('Original query failure');
  conn = connection({ fail: sql => sql.startsWith('SELECT * FROM BILL'), error: original,
    rollbackError: new Error('Rollback also failed') });
  await assert.rejects(invoke(), error => error === original);
  assert.deepEqual(lifecycle(conn), ['rollback', 'release']);

  conn = connection({ estimate: { RoomCharges: 'invalid', ServiceCharges: 0 } });
  await assert.rejects(invoke(), /Invalid monetary amount/);
  assert.deepEqual(lifecycle(conn), ['rollback', 'release']);

  acquireError = new Error('Connection unavailable');
  await assert.rejects(invoke(), error => error === acquireError);
  acquireError = undefined;

  console.log('PASS: bill read-only repeatable-read snapshot; canonical IDs and identities; ownership/missing 404; stored and estimated totals; decimal cents; historical line totals/dates; deterministic order; rollback/release and acquisition failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
