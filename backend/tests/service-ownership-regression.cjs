const assert = require('node:assert/strict');
const path = require('node:path');

// Dependency-free controller checks; no connection to MySQL is made.
const queries = [];
const bookings = new Map([[11, 1], [22, 2], [2147483647, 1]]);
const sampleUsage = [{ UsageID: 8, BookingID: 11, ServiceName: 'Laundry', Quantity: 2 }];
let databaseError;
let inReadSnapshot = false;
const lifecycle = [];
const connection = {
  execute: (...args) => {
    assert.equal(inReadSnapshot, true, 'Staff history reads stay inside one snapshot.');
    return pool.execute(...args);
  },
  async query(sql) {
    assert.ok(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'].includes(sql));
    lifecycle.push(sql);
    if (sql.startsWith('START ')) inReadSnapshot = true;
    return [[]];
  },
  async commit() { lifecycle.push('COMMIT'); inReadSnapshot = false; },
  async rollback() { lifecycle.push('ROLLBACK'); inReadSnapshot = false; },
  release() { lifecycle.push('RELEASE'); },
};
const pool = {
  async getConnection() { lifecycle.push('CONNECT'); return connection; },
  execute: async (sql, params) => {
    queries.push({ sql, params });
    if (databaseError) throw databaseError;
    if (/FROM BOOKING/.test(sql)) {
      if (params.length === 2) {
        assert.match(sql, /WHERE BookingID = \? AND (?:BOOKING\.)?GuestID = \?/);
        return [bookings.has(params[0]) && bookings.get(params[0]) === params[1]
          ? [{ BookingID: params[0] }] : []];
      }
      assert.equal(inReadSnapshot, true);
      assert.deepEqual(params, [params[0], 9, 'Receptionist', 3, 3]);
      assert.match(sql, /scope_staff\.StaffID = \?/);
      assert.match(sql, /NOT EXISTS[\s\S]*scope_room\.BranchID <> \?/);
      return [bookings.has(params[0]) ? [{ BookingID: params[0] }] : []];
    }
    assert.match(sql, /FROM SERVICE_USAGE/);
    assert.match(sql, /WHERE su\.BookingID = \?/);
    assert.equal(params.length, 1);
    return [params[0] === 11 ? sampleUsage : []];
  },
};
require.cache[require.resolve(path.join(__dirname, '../config/db'))] = { exports: pool };
const { listServiceUsageForBooking } = require('../controllers/serviceController');

function invoke(bookingId, user = { type: 'guest', id: 1 }) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    const staffScope = user?.type === 'staff' ? { staffId: user.id, role: user.role, branchId: 3, branchName: 'SkyNest Galle' } : undefined;
    listServiceUsageForBooking({ params: { bookingId }, user, staffScope }, res, reject);
  });
}

(async () => {
  for (const user of [{ type: 'guest', id: 1 }, { type: 'staff', id: 1, role: 'Receptionist' }]) {
    for (const raw of [undefined, null, '', '0', '-1', '01', '+1', '1.0', '1e2', ' 1 ',
      '2147483648', '99999999999999999999999', '1 OR 1=1', 1, ['11'], {}]) {
      assert.equal((await invoke(raw, user)).status, 400);
    }
  }
  assert.equal(queries.length, 0, 'Invalid route IDs must be rejected before SQL.');

  assert.deepEqual(await invoke('11'), { status: 200, data: sampleUsage });
  assert.equal(queries.length, 2, 'Guest ownership must be checked before fetching service usage.');
  assert.deepEqual(queries[0].params, [11, 1]);
  assert.match(queries[0].sql, /FROM BOOKING/);
  assert.deepEqual(queries[1].params, [11]);
  assert.match(queries[1].sql, /FROM SERVICE_USAGE/);

  for (const id of ['22', '33']) {
    queries.length = 0;
    assert.deepEqual(await invoke(id), { status: 404, data: { error: 'Booking not found.' } });
    assert.equal(queries.length, 1, 'Foreign and missing bookings must not expose service rows.');
    assert.match(queries[0].sql, /FROM BOOKING/);
    assert.deepEqual(queries[0].params, [Number(id), 1]);
  }

  queries.length = 0;
  assert.deepEqual(await invoke('2147483647'), { status: 200, data: [] });
  assert.deepEqual(queries[0].params, [2147483647, 1], 'Maximum signed SQL INT remains valid.');

  for (const id of ['11', '22', '33']) {
    queries.length = 0; lifecycle.length = 0;
    assert.deepEqual(await invoke(id, { type: 'staff', id: 9, role: 'Receptionist' }),
      id === '33' ? { status: 404, data: { error: 'Booking not found.' } }
        : { status: 200, data: id === '11' ? sampleUsage : [] });
    assert.equal(queries.length, id === '33' ? 1 : 2, 'Staff must pass booking scope before reading history.');
    assert.match(queries[0].sql, /FROM BOOKING/);
    if (id !== '33') {
      assert.match(queries[1].sql, /FROM SERVICE_USAGE/);
      assert.deepEqual(queries[1].params, [Number(id)]);
    }
    assert.deepEqual(lifecycle, ['CONNECT', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'COMMIT', 'RELEASE']);
  }

  databaseError = new Error('database unavailable');
  await assert.rejects(invoke('11'), /database unavailable/);
  console.log('PASS: service-usage ownership, nondisclosing missing/foreign responses, staff access, strict booking IDs and database errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
