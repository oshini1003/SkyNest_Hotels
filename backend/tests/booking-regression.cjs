const assert = require('node:assert/strict');
const { positiveInteger, validateBooking } = require('../utils/bookingValidation');

// Dependency-free controller tests: this fake pool never opens MySQL or changes
// data. The live API script separately checks stored-procedure behaviour.
const calls = [];
let handler;
let getConnectionError;
let releaseCount = 0;
const execute = async (sql, params = []) => {
  calls.push({ sql, params });
  if (!handler) throw new Error('Unexpected database call');
  return handler(sql, params);
};
const pool = {
  execute, query: execute,
  getConnection: async () => {
    if (getConnectionError) throw getConnectionError;
    return { execute, query: execute, release() { releaseCount++; } };
  },
};
require.cache[require.resolve('../config/db')] = { exports: pool };
const ctrl = require('../controllers/bookingController');
const guest = { type: 'guest', id: 4 };
const receptionist = { type: 'staff', id: 3, role: 'Receptionist' };
const stay = { roomId: 7, checkin: '2096-02-29', checkout: '2096-03-02', guestCount: 2, paymentMethod: 'Card' };
function invoke(action, values = {}) {
  return new Promise((resolve, reject) => {
    const req = { user: guest, query: {}, params: { id: '25' }, body: stay, ...values };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    ctrl[action](req, res, reject);
  });
}
function reset(nextHandler) { calls.length = 0; handler = nextHandler; }

(async () => {
  assert.equal(positiveInteger(7), 7);
  assert.equal(positiveInteger('7'), 7);
  for (const raw of [null, undefined, true, false, {}, [], ['7'], '', '0', 0, -1, 1.2, '01', '1e2', ' 1 ', '1 OR 1=1', Infinity, NaN, 2147483648]) {
    assert.equal(positiveInteger(raw), null);
    assert.equal((await invoke('makeBooking', { body: { ...stay, roomId: raw } })).status, 400);
    assert.equal((await invoke('makeBooking', { body: { ...stay, guestCount: raw } })).status, 400);
  }
  for (const body of [null, undefined, [], 'body', {}, { ...stay, checkin: undefined }, { ...stay, checkout: undefined },
    { ...stay, checkin: '2095-02-29' }, { ...stay, checkin: '2096-04-31' }, { ...stay, checkin: '2000-01-01' },
    { ...stay, checkout: stay.checkin }, { ...stay, checkin: '2096-03-03' },
    { ...stay, checkin: '2096-02-29T00:00:00Z' }, { ...stay, paymentMethod: 'Bitcoin' },
    { ...stay, paymentMethod: ['Card'] }, { ...stay, paymentMethod: '' }]) {
    assert.equal((await invoke('makeBooking', { body })).status, 400);
  }
  const fixedToday = new Date(2028, 1, 28, 23, 30);
  assert.ok(validateBooking({ ...stay, checkin: '2028-02-28', checkout: '2028-02-29' }, guest, fixedToday).value);
  assert.ok(validateBooking({ ...stay, checkin: '2028-02-27', checkout: '2028-02-29' }, guest, fixedToday).error);
  for (const role of ['Housekeeping', 'Service Staff', undefined]) {
    for (const action of ['makeBooking', 'cancelBooking', 'checkIn', 'checkOut']) {
      assert.equal((await invoke(action, { user: { type: 'staff', id: 2, role } })).status, 403);
    }
  }
  for (const action of ['makeBooking', 'cancelBooking', 'getBooking', 'listBookings']) {
    assert.equal((await invoke(action, { user: { type: 'guest', id: 0 } })).status, 403);
  }
  for (const action of ['checkIn', 'checkOut']) assert.equal((await invoke(action)).status, 403);
  for (const action of ['cancelBooking', 'getBooking', 'checkIn', 'checkOut']) {
    assert.equal((await invoke(action, { params: { id: '01' }, user: receptionist })).status, 400);
  }
  assert.equal(calls.length, 0, 'Invalid or forbidden requests must not execute SQL.');

  reset(async (sql) => sql === 'SELECT @p_booking_id' ? [[{ '@p_booking_id': 25 }]] : [{}]);
  const created = await invoke('makeBooking', { body: { ...stay, guestId: 999, roomId: '7', guestCount: '2' } });
  assert.deepEqual(created, { status: 201, data: { bookingId: 25, status: 'Booked' } });
  assert.equal(releaseCount, 1);
  assert.deepEqual(calls.find(call => call.sql.startsWith('CALL')).params, [4, null, 7, stay.checkin, stay.checkout, 2, 'Card']);
  assert.ok(calls.every(call => !/INSERT INTO (PAYMENT|BILL)/.test(call.sql)), 'Booking only records a payment preference.');
  for (const role of ['Admin', 'Manager', 'Receptionist']) {
    await invoke('makeBooking', { user: { ...receptionist, role }, body: { ...stay, guestId: '9', paymentMethod: 'Bank Transfer' } });
    assert.deepEqual(calls.filter(call => call.sql.startsWith('CALL')).at(-1).params, [9, 3, 7, stay.checkin, stay.checkout, 2, 'Bank Transfer']);
  }
  assert.equal((await invoke('makeBooking', { user: receptionist, body: stay })).status, 400);

  const errorCases = [
    [{ sqlState: '45000', sqlMessage: 'Room is already booked for an overlapping period.' }, 409],
    [{ code: 'ER_LOCK_DEADLOCK' }, 409], [{ code: 'ER_LOCK_WAIT_TIMEOUT' }, 409],
    [{ code: 'ER_NO_REFERENCED_ROW_2' }, 409],
  ];
  for (const [error, expected] of errorCases) {
    const beforeRelease = releaseCount;
    reset(async () => { throw error; });
    assert.equal((await invoke('makeBooking')).status, expected);
    assert.equal(releaseCount, beforeRelease + 1, 'Release the pooled connection even after a business conflict.');
  }
  reset(async () => { throw new Error('database offline'); });
  const beforeRelease = releaseCount;
  await assert.rejects(invoke('makeBooking'), /database offline/);
  assert.equal(releaseCount, beforeRelease + 1);
  getConnectionError = new Error('connection refused');
  await assert.rejects(invoke('makeBooking'), /connection refused/);
  assert.equal(releaseCount, beforeRelease + 1, 'No connection exists to release after acquisition failure.');
  getConnectionError = undefined;

  const room = { BookingID: 25, RoomID: 7, RoomNumber: '201', BranchID: 3, BranchName: 'SkyNest Galle',
    RoomTypeName: 'Suite', Capacity: 4, DailyRate: 25000, GuestCount: 2, CheckInDate: stay.checkin, CheckOutDate: stay.checkout };
  reset(async (sql, params) => {
    if (sql.includes('FROM BOOKING b')) {
      assert.match(sql, /WHERE b\.BookingID = \? AND b\.GuestID = \?/);
      assert.deepEqual(params, [25, 4]);
      return [[{ BookingID: 25, GuestID: 4, BookingStatus: 'Booked' }]];
    }
    assert.match(sql, /DATE_FORMAT\(br\.CheckInDateTime, '%Y-%m-%d'\) AS CheckInDate/);
    assert.match(sql, /DATE_FORMAT\(br\.CheckOutDateTime, '%Y-%m-%d'\) AS CheckOutDate/);
    return [[room]];
  });
  assert.deepEqual((await invoke('getBooking')).data.rooms, [room]);
  reset(async () => [[]]);
  assert.equal((await invoke('getBooking')).status, 404);
  assert.equal(calls.length, 1, 'Do not read rooms for a missing or foreign booking.');

  reset(async (sql, params) => {
    if (sql.includes('FROM BOOKING b')) {
      assert.match(sql, /LEFT JOIN ROOM r ON r\.RoomID = br\.RoomID/);
      assert.match(sql, /b\.GuestID = \?/);
      assert.match(sql, /r\.BranchID = \?/);
      assert.ok(!sql.includes('br.BranchID'));
      assert.deepEqual(params, [4, 'Booked', 3]);
      return [[{ BookingID: 25, GuestID: 4 }, { BookingID: 26, GuestID: 4 }]];
    }
    assert.deepEqual(params, [25, 26]);
    assert.match(sql, /WHERE br\.BookingID IN \(\?, \?\)/);
    return [[room, { ...room, BookingID: 26, RoomID: 6 }]];
  });
  const listed = await invoke('listBookings', { query: { guestId: '999', status: 'Booked', branchId: '3' } });
  assert.equal(calls.length, 2, 'One room batch query, not one per booking.');
  assert.equal(listed.data[0].rooms[0].BookingID, 25);
  assert.equal(listed.data[1].rooms[0].BookingID, 26);
  reset(async () => [[]]);
  assert.deepEqual((await invoke('listBookings', { query: { guestId: ['999'] } })).data, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [4], 'Even malformed spoofed guestId must never change guest list ownership.');
  reset();
  for (const query of [{ branchId: ['3'] }, { branchId: '0' }, { status: 'made-up' }, { guestName: {} }, { idNumber: [] }]) {
    assert.equal((await invoke('listBookings', { query })).status, 400);
  }
  assert.equal((await invoke('listBookings', { user: receptionist, query: { guestId: '0' } })).status, 400);
  assert.equal(calls.length, 0);

  let bookingStatus = 'Booked';
  reset(async (sql, params) => {
    assert.deepEqual(params, [25, 4]);
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /WHERE BookingID = \? AND GuestID = \? AND BookingStatus = 'Booked'/);
      const affectedRows = bookingStatus === 'Booked' ? 1 : 0;
      if (affectedRows) bookingStatus = 'Cancelled';
      return [{ affectedRows }];
    }
    assert.match(sql, /WHERE BookingID = \? AND GuestID = \?/);
    return [[{ BookingStatus: bookingStatus }]];
  });
  const race = await Promise.all([invoke('cancelBooking'), invoke('cancelBooking')]);
  assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
  for (const status of ['Checked-In', 'Checked-Out', 'Cancelled']) {
    bookingStatus = status;
    assert.equal((await invoke('cancelBooking')).status, 409);
    assert.equal(bookingStatus, status, 'Cancelling must not overwrite a checked-in/out reservation.');
  }
  reset(async sql => sql.startsWith('UPDATE') ? [{ affectedRows: 0 }] : [[]]);
  assert.equal((await invoke('cancelBooking')).status, 404);
  assert.ok(calls.every(call => call.sql.includes('GuestID = ?')), 'Both cancellation and follow-up lookup must scope ownership.');
  reset(async (sql, params) => {
    assert.deepEqual(params, [25]);
    assert.ok(!sql.includes('GuestID = ?'));
    return [{ affectedRows: 1 }];
  });
  assert.equal((await invoke('cancelBooking', { user: receptionist })).status, 200);
  reset(async () => { throw new Error('read failed'); });
  for (const action of ['getBooking', 'listBookings', 'cancelBooking']) await assert.rejects(invoke(action), /read failed/);

  console.log('PASS: booking validation, guest identity and ownership, staff permissions, batch room details and date strings, conditional cancellation races, conflict handling and pooled-connection release (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
