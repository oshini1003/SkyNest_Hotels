const assert = require('node:assert/strict');
const { validateBookingFilters } = require('../utils/bookingValidation');

// These controller checks use a fake pool. No real booking or bill is changed.
const calls = [];
let db;
let readTransaction = false;
const readLifecycle = [];
const readConnection = {
  execute: (...args) => {
    assert.equal(readTransaction, true, 'Staff preflight/detail reads use one snapshot.');
    return execute(...args);
  },
  async query(sql, params) {
    if (sql.startsWith('SELECT ')) { assert.equal(readTransaction, true); return execute(sql, params); }
    readLifecycle.push(sql);
    assert.ok(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'].includes(sql));
    if (sql.startsWith('START ')) readTransaction = true;
    return [[]];
  },
  async commit() { readLifecycle.push('COMMIT'); readTransaction = false; },
  async rollback() { readLifecycle.push('ROLLBACK'); readTransaction = false; },
  release() { readLifecycle.push('RELEASE'); },
};
const execute = async (sql, params = []) => {
  if (sql.startsWith('CALL ')) assert.equal(readTransaction, false, 'The read snapshot must close before the procedure owns its write transaction.');
  calls.push({ sql, params });
  if (!db) throw new Error('Unexpected database access');
  return db(sql, params);
};
require.cache[require.resolve('../config/db')] = { exports: { execute, query: execute, async getConnection() { readLifecycle.push('CONNECT'); return readConnection; } } };
const ctrl = require('../controllers/bookingController');
const staff = { type: 'staff', id: 3, role: 'Receptionist' };
const guest = { type: 'guest', id: 4 };
const today = '2096-02-29'; // Deliberately different from the machine date.
const booking = { BookingID: 25, GuestID: 4, BookingStatus: 'Booked', ServerToday: today,
  GuestName: 'Example Guest', GuestContact: '0712345678', GuestIDNumber: 'TEST-ID', GuestEmail: 'guest@example.com' };
const room = { BookingID: 25, RoomID: 7, RoomNumber: '201', BranchID: 3, BranchName: 'SkyNest Galle',
  RoomStatus: 'Available', RoomTypeName: 'Suite', Capacity: 4, DailyRate: 25000,
  CheckInDate: today, CheckOutDate: '2096-03-02', GuestCount: 2 };

function reset(handler) { calls.length = 0; readLifecycle.length = 0; assert.equal(readTransaction, false); db = handler; }
function invoke(action, values = {}) {
  return new Promise((resolve, reject) => {
    const req = { user: staff, params: { id: '25' }, query: {}, body: {}, ...values };
    if (req.user?.type === 'staff') req.staffScope = { staffId: req.user.id, role: req.user.role, branchId: 3, branchName: 'SkyNest Galle' };
    const res = { statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    ctrl[action](req, res, reject);
  });
}
function storedState(header = booking, rooms = [room], procedureError) {
  return async (sql, params) => {
    if (sql.startsWith('CALL ')) {
      assert.equal(sql, 'CALL sp_check_in(?, ?)');
      assert.deepEqual(params, [25, 3]);
      if (procedureError) throw procedureError;
      return [[]];
    }
    if (sql.includes('FROM BOOKING')) {
      assert.deepEqual(params, [25, 3, params[2], 3, ...(params[2] === 'Receptionist' ? [3] : [])]);
      assert.ok(['Admin', 'Manager', 'Receptionist'].includes(params[2]));
      assert.match(sql, /scope_staff\.StaffID = \?/);
      assert.match(sql, /DATE_FORMAT\(CURDATE\(\), '%Y-%m-%d'\) AS ServerToday/);
      return [header ? [header] : []];
    }
    assert.deepEqual(params, [25]);
    assert.match(sql, /r\.RoomStatus/);
    assert.match(sql, /DATE_FORMAT\(br\.CheckInDateTime, '%Y-%m-%d'\) AS CheckInDate/);
    assert.match(sql, /DATE_FORMAT\(br\.CheckOutDateTime, '%Y-%m-%d'\) AS CheckOutDate/);
    return [rooms];
  };
}

(async () => {
  reset();
  for (const user of [guest, { ...staff, role: 'Service Staff' }, { ...staff, role: 'ServiceStaff' },
    { ...staff, role: 'Housekeeping' }, { ...staff, role: undefined }, { ...staff, id: 0 }, undefined]) {
    assert.equal((await invoke('checkIn', { user })).status, 403);
  }
  for (const raw of ['', '0', '01', '-1', '1.5', '1e2', ' 25 ', '25 OR 1=1', ['25'], {}, undefined, '2147483648']) {
    assert.equal((await invoke('checkIn', { params: { id: raw } })).status, 400);
    assert.equal((await invoke('getBooking', { params: { id: raw } })).status, 400);
    if (raw !== undefined) {
      assert.ok(validateBookingFilters({ bookingId: raw }, staff).error);
      assert.equal((await invoke('listBookings', { query: { bookingId: raw } })).status, 400);
    }
  }
  assert.equal(calls.length, 0, 'Permissions and invalid IDs are checked before SQL.');

  reset(storedState(null));
  assert.equal((await invoke('checkIn')).status, 404);
  assert.equal(calls.length, 1, 'Missing bookings do not read rooms or call the procedure.');

  const blocked = [
    [{ ...booking, BookingStatus: 'Cancelled' }, [room], /Only a Booked/],
    [{ ...booking, BookingStatus: 'Checked-In' }, [room], /Only a Booked/],
    [{ ...booking, BookingStatus: 'Checked-Out' }, [room], /Only a Booked/],
    [booking, [], /no rooms/],
    [booking, [{ ...room, CheckInDate: '2096-03-01' }], /arrival date/],
    [booking, [{ ...room, CheckOutDate: today }], /stay has ended/],
    [booking, [{ ...room, CheckInDate: '2096-02-27', CheckOutDate: '2096-02-28' }], /stay has ended/],
    [booking, [{ ...room, RoomStatus: 'Occupied' }], /Available/],
    [booking, [{ ...room, RoomStatus: 'Maintenance' }], /Available/],
    [booking, [room, { ...room, RoomID: 8, CheckInDate: '2096-03-01' }], /arrival date/],
    [booking, [room, { ...room, RoomID: 8, RoomStatus: 'Occupied' }], /Available/],
  ];
  for (const [header, rooms, reason] of blocked) {
    reset(storedState(header, rooms));
    const result = await invoke('checkIn');
    assert.equal(result.status, 409);
    assert.match(result.data.error, reason);
    assert.ok(calls.every(call => !call.sql.startsWith('CALL ')), 'Ineligible stays never reach the stored procedure.');
    reset(storedState(header, rooms));
    const detail = await invoke('getBooking');
    assert.equal(detail.status, 200, 'Ineligible bookings are still readable.');
    assert.deepEqual(detail.data.checkInEligibility, { allowed: false, reason: result.data.error, today });
  }

  for (const role of ['Admin', 'Manager', 'Receptionist']) {
    for (const checkin of [today, '2096-02-28']) {
      reset(storedState(booking, [{ ...room, CheckInDate: checkin }]));
      assert.deepEqual(await invoke('checkIn', { user: { ...staff, role } }),
        { status: 200, data: { bookingId: 25, status: 'Checked-In' } });
      assert.equal(calls.filter(call => call.sql.startsWith('CALL ')).length, 1);
      assert.deepEqual(readLifecycle, ['CONNECT', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
        'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'COMMIT', 'RELEASE']);
      assert.ok(calls.every(call => !/START TRANSACTION|BEGIN|COMMIT|ROLLBACK/.test(call.sql)),
        'The procedure owns its transaction; the controller must not wrap it.');
    }
  }

  reset(storedState());
  assert.equal((await invoke('checkIn', { body: { staffId: 999, StaffID: 999, actorType: 'guest' } })).status, 200);
  assert.deepEqual(calls.find(call => call.sql.startsWith('CALL ')).params, [25, 3], 'Check-in audit actor must come from the token.');

  reset(storedState());
  const detail = await invoke('getBooking');
  assert.equal(detail.data.GuestIDNumber, 'TEST-ID');
  assert.equal(detail.data.GuestEmail, 'guest@example.com');
  assert.equal(detail.data.rooms[0].RoomStatus, 'Available');
  assert.deepEqual(detail.data.checkInEligibility, { allowed: true, reason: null, today });
  assert.equal(detail.data.ServerToday, undefined, 'Expose the calendar date through the eligibility contract.');

  reset(async (sql, params) => {
    assert.match(sql, /WHERE b\.BookingID = \? AND b\.GuestID = \?/);
    assert.deepEqual(params, [25, 4]);
    return [[]];
  });
  assert.equal((await invoke('getBooking', { user: guest })).status, 404);
  assert.equal(calls.length, 1, 'Guest ownership remains part of the first lookup.');

  reset(async (sql, params) => {
    if (sql.includes('FROM BOOKING b')) {
      assert.match(sql, /b\.BookingID = \?/);
      assert.match(sql, /r\.BranchID = \?/);
      assert.ok(!sql.includes('br.BranchID'));
      assert.ok(!sql.includes("Ann' OR 1=1 --"));
      assert.deepEqual(params, [25, 'Booked', 3, "%Ann' OR 1=1 --%", 'TEST-ID', 3, 'Receptionist', 3, 3]);
      return [[booking]];
    }
    assert.deepEqual(params, [25]);
    assert.match(sql, /r\.RoomStatus/);
    return [[room]];
  });
  const list = await invoke('listBookings', { query: { bookingId: '25', status: 'Booked', branchId: '3',
    guestName: " Ann' OR 1=1 -- ", idNumber: ' TEST-ID ' } });
  assert.equal(list.data[0].rooms[0].RoomStatus, 'Available');
  assert.equal(calls.length, 2, 'The list still uses a single batch query for booked rooms.');
  reset(async (sql, params) => {
    assert.match(sql, /b\.GuestID = \? AND b\.BookingID = \?/);
    assert.deepEqual(params, [4, 25]);
    return [[]];
  });
  assert.deepEqual((await invoke('listBookings', { user: guest, query: { guestId: '99', bookingId: '25' } })).data, []);

  // The state can change after the initial reads: the DB's final decision wins.
  for (const error of [{ sqlState: '45000', sqlMessage: 'Only a Booked reservation can be checked in.' },
    { sqlState: '45000', sqlMessage: 'Every room must be Available before check-in.' },
    { code: 'ER_LOCK_DEADLOCK' }, { code: 'ER_LOCK_WAIT_TIMEOUT' }]) {
    reset(storedState(booking, [room], error));
    assert.equal((await invoke('checkIn')).status, 409);
    assert.equal(calls.filter(call => call.sql.startsWith('CALL ')).length, 1);
  }
  reset(storedState(booking, [room], new Error('procedure unavailable')));
  await assert.rejects(invoke('checkIn'), /procedure unavailable/);
  reset(async () => { throw new Error('database unavailable'); });
  await assert.rejects(invoke('checkIn'), /database unavailable/);

  console.log('PASS: staff permissions, reference/branch filters, guest ownership, database-date eligibility, blocked check-ins, stored-procedure conflicts and transaction ownership (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
