const assert = require('node:assert/strict');
const path = require('node:path');
const { positiveInteger, validateServiceUsage } = require('../utils/serviceUsageValidation');

// Dependency-free controller checks. The real procedure remains responsible for
// transaction locking, price snapshots and bill recalculation; no MySQL is used.
const calls = [];
const bookings = new Map([
  [11, { GuestID: 1, BookingStatus: 'Checked-In' }],
  [22, { GuestID: 2, BookingStatus: 'Checked-In' }],
  [31, { GuestID: 1, BookingStatus: 'Booked' }],
  [32, { GuestID: 1, BookingStatus: 'Checked-Out' }],
  [33, { GuestID: 1, BookingStatus: 'Cancelled' }],
  [2147483647, { GuestID: 1, BookingStatus: 'Checked-In' }],
]);
const usage = [{
  UsageID: 8, BookingID: 11, ServiceID: 5, ServiceName: 'Laundry', Quantity: 2,
  PriceAtUsage: '25.00', UsageDate: '2026-10-03T10:15:00.000Z',
  UsageDateDisplay: '2026-10-03 10:15:00', LineTotal: '50.00',
}];
let procedureError;
let lookupError;
const pool = {
  execute: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM BOOKING/.test(sql)) {
      if (lookupError) throw lookupError;
      assert.match(sql, /WHERE BookingID = \?(?: AND GuestID = \?)?$/);
      const booking = bookings.get(params[0]);
      return [booking && (params.length === 1 || booking.GuestID === params[1]) ? [booking] : []];
    }
    if (/^CALL sp_log_service_usage/.test(sql)) {
      assert.equal(sql, 'CALL sp_log_service_usage(?, ?, ?, ?, ?)');
      assert.equal(params.length, 5);
      assert.ok(params.slice(0, 3).every(value => positiveInteger(value) === value));
      assert.ok((params[3] === null) !== (params[4] === null));
      assert.ok(params.slice(3).every(value => value === null || positiveInteger(value) === value));
      if (procedureError) throw procedureError;
      if ([98, 99].includes(params[1])) {
        throw { sqlState: '45000', sqlMessage: 'Choose an active service.' };
      }
      // A driver result is not a reliable service usage ID.
      return [{ affectedRows: 1, insertId: 987 }];
    }
    assert.match(sql, /FROM SERVICE_USAGE/);
    assert.match(sql, /WHERE su\.BookingID = \?/);
    assert.equal(params.length, 1);
    return [params[0] === 11 ? usage : []];
  },
  getConnection() { throw new Error('Do not open an application transaction for service usage.'); },
  query() { throw new Error('All controller queries must use parameterized execute.'); },
  beginTransaction() { throw new Error('The procedure owns the transaction.'); },
  commit() { throw new Error('The procedure owns the transaction.'); },
  rollback() { throw new Error('The procedure owns the transaction.'); },
};
require.cache[require.resolve(path.join(__dirname, '../config/db'))] = { exports: pool };
const { logServiceUsage, listServiceUsageForBooking, listServices } = require('../controllers/serviceController');

const guest = { type: 'guest', id: 1 };
const validBody = { bookingId: 11, serviceId: 5, quantity: 2 };
function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    handler(req, res, reject);
  });
}
const post = (body = validBody, user = guest) => invoke(logServiceUsage, { body, user });
const get = (bookingId = '11', user = guest) => invoke(listServiceUsageForBooking, { params: { bookingId }, user });
const reset = () => { calls.length = 0; procedureError = undefined; lookupError = undefined; };

(async () => {
  const invalid = [undefined, null, '', '0', '-1', '01', '+1', '1.0', '1e2', ' 1 ', '1\n',
    '2147483648', '99999999999999999999999', '1 OR 1=1', '2garbage', '0x10',
    0, -1, 1.5, 2147483648, NaN, Infinity, -Infinity, true, false, [], [1], {}, new Number(1)];
  for (const raw of invalid) {
    assert.equal(positiveInteger(raw), null);
    for (const field of ['bookingId', 'serviceId', 'quantity']) {
      assert.equal((await post({ ...validBody, [field]: raw })).status, 400, `${field}: ${String(raw)}`);
    }
  }
  for (const body of [null, '', 1, true, [], {}]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.ok(validateServiceUsage(undefined).error);
  assert.equal(calls.length, 0, 'Invalid inputs must not reach SQL.');
  for (const raw of [1, '1', 100, '100', 2147483647, '2147483647']) {
    assert.equal(positiveInteger(raw), Number(raw));
  }

  for (const user of [null, {}, { type: 'other', id: 1 },
    { type: 'staff', id: 1 }, { type: 'staff', id: 1, role: 'Housekeeping' },
    { type: 'staff', id: 1, role: 'admin' }, { type: 'staff', id: 1, role: ['Admin'] }]) {
    assert.equal((await post(validBody, user)).status, 403);
  }
  assert.equal((await invoke(logServiceUsage, { body: validBody })).status, 403);
  for (const id of invalid) {
    for (const type of ['guest', 'staff']) {
      assert.equal((await post(validBody, { type, id, role: 'Admin' })).status, 403);
    }
  }
  assert.equal(calls.length, 0, 'Invalid identities or roles must not reach SQL.');

  assert.deepEqual(await post({ bookingId: '11', serviceId: '5', quantity: '2' }, { type: 'guest', id: '1' }), {
    status: 201, data: validBody,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /WHERE BookingID = \? AND GuestID = \?/);
  assert.deepEqual(calls[0].params, [11, 1]);
  assert.deepEqual(calls[1].params, [11, 5, 2, null, 1]);

  for (const role of ['Admin', 'Manager', 'Receptionist', 'ServiceStaff']) {
    reset();
    assert.deepEqual(await post({ ...validBody, bookingId: 22 }, { type: 'staff', id: 9, role }), {
      status: 201, data: { ...validBody, bookingId: 22 },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, [22]);
    assert.doesNotMatch(calls[0].sql, /GuestID/);
    assert.deepEqual(calls[1].params, [22, 5, 2, 9, null]);
  }

  reset();
  const max = 2147483647;
  assert.deepEqual(await post({ bookingId: String(max), serviceId: String(max), quantity: String(max) }), {
    status: 201, data: { bookingId: max, serviceId: max, quantity: max },
  });
  assert.deepEqual(calls[1].params, [max, max, max, null, 1]);

  for (const bookingId of [22, 404]) {
    reset();
    assert.deepEqual(await post({ ...validBody, bookingId, guestId: 2, GuestID: 2 }), {
      status: 404, data: { error: 'Booking not found.' },
    });
    assert.equal(calls.length, 1, 'Foreign and missing bookings must stop before the procedure.');
    assert.deepEqual(calls[0].params, [bookingId, 1]);
  }
  reset();
  assert.deepEqual(await post({ ...validBody, bookingId: 404 }, { type: 'staff', id: 9, role: 'ServiceStaff' }), {
    status: 404, data: { error: 'Booking not found.' },
  });
  assert.equal(calls.length, 1);

  for (const bookingId of [31, 32, 33]) {
    reset();
    assert.deepEqual(await post({ ...validBody, bookingId }), {
      status: 409, data: { error: 'Services can only be logged against a Checked-In booking.' },
    });
    assert.equal(calls.length, 1, 'Known ineligible bookings must stop before the procedure.');
  }

  reset();
  assert.deepEqual(await post({ ...validBody, guestId: 999, GuestID: 999, bookingGuestId: 999, staffId: 888, StaffID: 888, actorType: "staff",
    price: 0, unitPrice: 0, PriceAtUsage: 0, lineTotal: 0 }), { status: 201, data: validBody });
  assert.deepEqual(calls[0].params, [11, 1]);
  assert.deepEqual(calls[1].params, [11, 5, 2, null, 1], 'Browser-supplied price and guest identity cannot reach the procedure.');
  assert.ok(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|START TRANSACTION|COMMIT|ROLLBACK)\b/.test(sql)));

  for (const serviceId of [98, 99]) {
    reset();
    assert.deepEqual(await post({ ...validBody, serviceId }), {
      status: 409, data: { error: 'Choose an active service.' },
    });
    assert.equal(calls.length, 2, 'Missing and inactive services are rejected by the procedure.');
  }
  reset();
  procedureError = { sqlState: '45000', sqlMessage: 'Services can only be logged against a Checked-In booking.' };
  assert.equal((await post()).status, 409, 'The locked procedure recheck can reject a status change after the lookup.');
  assert.equal(calls.length, 2);
  reset();
  procedureError = { sqlState: '45000' };
  assert.equal((await post()).status, 409);

  const controlledErrors = [
    [{ code: 'ER_LOCK_DEADLOCK' }, 409], [{ code: 'ER_LOCK_WAIT_TIMEOUT' }, 409],
    [{ errno: 1205 }, 409], [{ errno: 1213 }, 409],
    [{ code: 'ER_WARN_DATA_OUT_OF_RANGE' }, 400], [{ code: 'ER_DATA_OUT_OF_RANGE' }, 400],
    [{ sqlState: '22003' }, 400], [{ errno: 1264 }, 400], [{ errno: 1690 }, 400],
    [{ code: 'ER_CHECK_CONSTRAINT_VIOLATED' }, 409], [{ code: 'ER_CONSTRAINT_FAILED' }, 409],
    [{ errno: 3819 }, 409], [{ errno: 4025 }, 409],
    [{ code: 'ER_NO_REFERENCED_ROW_2' }, 409], [{ errno: 1452 }, 409],
  ];
  for (const [error, status] of controlledErrors) {
    reset();
    procedureError = { ...error, sqlMessage: 'private database details' };
    const result = await post();
    assert.equal(result.status, status);
    assert.ok(result.data.error.length > 0);
    assert.doesNotMatch(result.data.error, /private database details/);
    assert.equal(calls.length, 2, 'A failed procedure must never be automatically retried.');
  }
  reset();
  lookupError = { code: 'ER_LOCK_WAIT_TIMEOUT' };
  assert.equal((await post()).status, 409);
  assert.equal(calls.length, 1);
  reset();
  procedureError = new Error('database unavailable');
  await assert.rejects(post(), /database unavailable/);
  assert.equal(calls.length, 2);

  reset();
  assert.deepEqual(await get(), { status: 200, data: usage });
  assert.match(calls[1].sql, /su\.Quantity \* su\.PriceAtUsage\) AS LineTotal/);
  assert.match(calls[1].sql, /DATE_FORMAT\(su\.UsageDate, '%Y-%m-%d %H:%i:%s'\) AS UsageDateDisplay/);
  assert.match(calls[1].sql, /ORDER BY su\.UsageDate DESC, su\.UsageID DESC$/);
  assert.doesNotMatch(calls[1].sql, /sc\.UnitPrice|IsActive/);
  assert.deepEqual(calls[1].params, [11]);
  reset();
  assert.deepEqual(await get('22'), { status: 404, data: { error: 'Booking not found.' } });
  assert.equal(calls.length, 1);

  // The public catalogue keeps its existing active-only response and query.
  const execute = pool.execute;
  pool.execute = async (sql, params) => {
    assert.equal(sql, 'SELECT * FROM SERVICE_CATALOGUE WHERE IsActive = TRUE ORDER BY ServiceName');
    assert.equal(params, undefined);
    return [[{ ServiceID: 5, ServiceName: 'Laundry', UnitPrice: '30.00', IsActive: 1 }]];
  };
  const catalogue = await invoke(listServices, {});
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.data[0].UnitPrice, '30.00');
  pool.execute = execute;
  console.log('PASS: strict service input and identity, staff roles, guest ownership, booking state, procedure conflicts, safe error mapping, parameterization, transaction ownership and history contract.');
})().catch(error => { console.error(error); process.exitCode = 1; });
