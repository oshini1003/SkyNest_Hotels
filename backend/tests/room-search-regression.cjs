const assert = require('node:assert/strict');
const path = require('node:path');
const { validateRoomSearch } = require('../utils/roomSearchValidation');

// No database is created or contacted by these controller contract tests.
const queries = [];
let databaseError;
const sampleRows = [{ RoomID: 7, RoomNumber: '101', BranchID: 2, Capacity: 2, DailyRate: 12000 }];
const pool = {
  execute: async (sql, params) => {
    queries.push({ sql, params });
    if (databaseError) throw databaseError;
    return [sampleRows];
  },
};
require.cache[require.resolve(path.join(__dirname, '../config/db'))] = { exports: pool };
const { searchRooms } = require('../controllers/roomController');

function invoke(query) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    searchRooms({ query }, res, reject);
  });
}

(async () => {
  const fixedToday = new Date(2028, 1, 28, 23, 30);
  const leapStay = { checkin: '2028-02-29', checkout: '2028-03-01' };
  assert.deepEqual(validateRoomSearch(leapStay, fixedToday).value, leapStay);
  assert.ok(validateRoomSearch({ checkin: '2028-02-28', checkout: '2028-02-29' }, fixedToday).value);
  for (const dates of [
    { checkin: '2028-02-27', checkout: '2028-02-29' }, // yesterday in server local time
    { checkin: '2028-02-29', checkout: '2028-02-29' },
    { checkin: '2028-03-02', checkout: '2028-03-01' },
    { checkin: '2029-02-29', checkout: '2029-03-01' },
    { checkin: '2028-04-31', checkout: '2028-05-02' },
    { checkin: '2028-13-01', checkout: '2029-01-02' },
    { checkin: '2028-00-01', checkout: '2028-01-02' },
    { checkin: '2028-03-00', checkout: '2028-03-02' },
    { checkin: '0999-03-01', checkout: '2028-03-02' },
    { checkin: '2028-2-29', checkout: '2028-03-01' },
    { checkin: '2028-02-29T14:00:00', checkout: '2028-03-01' },
  ]) assert.ok(validateRoomSearch(dates, fixedToday).error, JSON.stringify(dates));

  const invalidQueries = [
    { checkin: '2096-02-29' }, { checkout: '2096-03-01' },
    { checkin: '', checkout: '' },
    { checkin: ['2096-02-29'], checkout: '2096-03-01' },
    { checkin: '2096-02-29', checkout: { gt: '2096-03-01' } },
    { checkin: '2095-02-29', checkout: '2095-03-01' },
    { checkin: '2000-01-01', checkout: '2000-01-02' },
  ];
  for (const field of ['roomId', 'branchId', 'roomTypeId', 'guestCount']) {
    for (const raw of ['', '0', '-1', '1.5', '1e2', ' 1 ', '01', '2147483648', '1 OR 1=1', ['1', '2'], {}, null]) {
      invalidQueries.push({ [field]: raw });
    }
  }
  for (const query of invalidQueries) {
    assert.equal((await invoke(query)).status, 400, JSON.stringify(query));
  }
  assert.equal(queries.length, 0, 'Invalid searches must never reach the database.');

  const response = await invoke({ roomId: '7', branchId: '2', roomTypeId: '3', guestCount: '2', checkin: '2096-02-29', checkout: '2096-03-01' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, sampleRows, 'Keep the existing PascalCase response contract.');
  const search = queries.at(-1);
  assert.deepEqual(search.params, [7, 2, 3, 2, '2096-02-29', '2096-03-01']);
  assert.equal((search.sql.match(/\?/g) || []).length, search.params.length);
  assert.ok(!search.sql.includes('2096-02-29'), 'Dates must be bound parameters.');
  assert.match(search.sql, /r\.RoomID = \?/);
  assert.match(search.sql, /r\.BranchID = \?/);
  assert.match(search.sql, /r\.RoomTypeID = \?/);
  assert.match(search.sql, /rt\.Capacity >= \?/);
  assert.match(search.sql, /r\.RoomStatus != 'Maintenance'/);
  assert.ok(!search.sql.includes("r.RoomStatus = 'Available'"), 'Present occupancy must not block all future stays.');
  assert.match(search.sql, /NOT EXISTS[\s\S]*booked_room\.RoomID = r\.RoomID/);
  assert.match(search.sql, /b\.BookingStatus IN \('Booked','Checked-In'\)/);
  assert.match(search.sql, /\? < booked_room\.CheckOutDateTime AND \? > booked_room\.CheckInDateTime/, 'Checkout/check-in boundaries must remain non-overlapping.');

  await invoke({});
  assert.deepEqual(queries.at(-1).params, []);
  assert.ok(!queries.at(-1).sql.includes('BOOKED_ROOMS'), 'No-date searches remain catalogue requests.');
  await invoke({ roomId: '7' });
  assert.deepEqual(queries.at(-1).params, [7]);
  assert.ok(!queries.at(-1).sql.includes('BOOKED_ROOMS'), 'An ID-only lookup is not date availability.');

  databaseError = new Error('database unavailable');
  await assert.rejects(invoke({}), /database unavailable/);
  console.log('PASS: strict room filters, calendar/local-date validation, invalid requests blocked before SQL, parameterized search, capacity/maintenance/overlap query contracts, catalogue compatibility and database errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
