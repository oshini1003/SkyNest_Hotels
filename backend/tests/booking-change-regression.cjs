const assert = require('node:assert/strict');

// Dependency-free controller tests (fake pool, no MySQL), same approach as booking-regression.cjs.
const calls = [];
const events = [];
let handler;
const execute = async (sql, params = []) => {
  calls.push({ sql, params });
  if (!handler) throw new Error('Unexpected database call');
  return handler(sql, params);
};
const connection = {
  execute, query: execute,
  beginTransaction: async () => events.push('BEGIN'),
  commit: async () => events.push('COMMIT'),
  rollback: async () => events.push('ROLLBACK'),
  release() { events.push('RELEASE'); },
};
const pool = { execute, query: execute, getConnection: async () => { events.push('CONNECT'); return connection; } };
require.cache[require.resolve('../config/db')] = { exports: pool };
const ctrl = require('../controllers/bookingController');

const guest = { type: 'guest', id: 4 };
const receptionist = { type: 'staff', id: 3, role: 'Receptionist' };
const multi = { paymentMethod: 'Card', checkin: '2096-03-01', checkout: '2096-03-03',
  rooms: [{ roomId: 7, guestCount: 1 }, { roomId: 4, guestCount: 2 }] };
const overlap = { sqlState: '45000', sqlMessage: 'Room is already booked for an overlapping period.' };
const line = { BookedRoomID: 9, CheckInDate: '2096-03-01', CheckOutDate: '2096-03-03' };

function invoke(action, values = {}) {
  return new Promise((resolve, reject) => {
    const req = { user: guest, query: {}, params: { id: '25' }, body: multi, ...values };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    ctrl[action](req, res, reject);
  });
}
function reset(nextHandler) { calls.length = 0; events.length = 0; handler = nextHandler; }
const roomDb = (room = { RoomStatus: 'Available', Capacity: 2 }) => async sql => {
  if (/^INSERT INTO BOOKING\b/.test(sql)) return [{ insertId: 55 }];
  if (/FROM ROOM r/.test(sql)) return [[room]];
  if (/FROM BOOKED_ROOMS br/.test(sql)) return [[]];      // locking overlap read: no clash
  return [{}];
};
const updateDb = (lines = [line]) => async sql =>
  sql.includes('FROM BOOKING WHERE') ? [[{ BookingID: 25 }]]
    : sql.includes('FROM BOOKED_ROOMS WHERE') ? [lines] : [[]];
const patch = (body, user = guest) => invoke('updateBooking', { user, body });

(async () => {
  // Invalid or forbidden requests never reach the database.
  reset();
  for (const rooms of [[], Array(11).fill({ roomId: 1, guestCount: 1 }), [null], [{ roomId: 4 }],
    [{ roomId: 0, guestCount: 1 }], [{ roomId: 4, guestCount: -1 }],
    [{ roomId: 4, guestCount: 1 }, { roomId: 4, guestCount: 1 }]]) {
    assert.equal((await invoke('makeBooking', { body: { ...multi, rooms } })).status, 400);
  }
  assert.equal((await invoke('makeBooking', { body: { ...multi, checkin: '2000-01-01' } })).status, 400);
  assert.equal((await invoke('makeBooking', { user: receptionist })).status, 400, 'Staff must name the guest.');
  assert.equal((await invoke('makeBooking', { user: { type: 'staff', id: 2, role: 'ServiceStaff' } })).status, 403);
  assert.equal((await invoke('makeBooking', { body: null })).status, 400, 'A null body must not crash the dispatcher.');
  for (const user of [{ type: 'staff', id: 2, role: 'ServiceStaff' }, { type: 'guest', id: 0 }]) {
    assert.equal((await patch({ roomId: 2 }, user)).status, 403);
  }
  assert.equal(calls.length + events.length, 0);

  // Success: guest identity from the token, rooms locked in ascending order, one commit.
  reset(roomDb());
  assert.deepEqual(await invoke('makeBooking', { body: { ...multi, guestId: 999 } }),
    { status: 201, data: { bookingId: 55, status: 'Booked', rooms: 2 } });
  assert.deepEqual(events, ['CONNECT', 'BEGIN', 'COMMIT', 'RELEASE']);
  assert.deepEqual(calls.find(c => c.sql.startsWith('INSERT INTO BOOKING ')).params, [4, null, 'Card']);
  assert.deepEqual(calls.filter(c => c.sql.includes('FOR UPDATE OF r')).map(c => c.params[0]), [4, 7]);
  assert.deepEqual(calls.filter(c => c.sql.includes('INSERT INTO BOOKED_ROOMS')).map(c => c.params),
    [[55, 4, '2096-03-01', '2096-03-03', 2], [55, 7, '2096-03-01', '2096-03-03', 1]]);
  reset(roomDb());
  await invoke('makeBooking', { user: receptionist, body: { ...multi, guestId: '9' } });
  assert.deepEqual(calls.find(c => c.sql.startsWith('INSERT INTO BOOKING ')).params, [9, 3, 'Card']);

  // Any failure rolls back the whole booking and releases the connection.
  const rolledBack = ['CONNECT', 'BEGIN', 'ROLLBACK', 'RELEASE'];
  reset(async (sql, params) => { if (sql.includes('INSERT INTO BOOKED_ROOMS')) throw overlap; return roomDb()(sql, params); });
  assert.equal((await invoke('makeBooking')).status, 409);
  assert.deepEqual(events, rolledBack);
  // A clash seen by the locking read (committed while this request waited for the room lock).
  reset(async (sql, params) => /FROM BOOKED_ROOMS br/.test(sql) ? [[{ BookedRoomID: 3 }]] : roomDb()(sql, params));
  assert.equal((await invoke('makeBooking')).status, 409);
  assert.deepEqual(events, rolledBack);
  assert.ok(calls.every(c => !c.sql.includes('INSERT INTO BOOKED_ROOMS')));
  reset(roomDb({ RoomStatus: 'Maintenance', Capacity: 2 }));
  assert.equal((await invoke('makeBooking')).status, 409);
  reset(roomDb({ RoomStatus: 'Available', Capacity: 1 }));
  assert.equal((await invoke('makeBooking')).status, 400, 'Room 4 holds one guest but two were requested.');
  reset(async sql => /FROM ROOM r/.test(sql) ? [[]] : roomDb()(sql));
  assert.equal((await invoke('makeBooking')).status, 404);
  reset(async () => { throw new Error('database offline'); });
  await assert.rejects(invoke('makeBooking'), /database offline/);
  assert.deepEqual(events, rolledBack);

  // Update: date change, room-only change, and one date validated against the stored other.
  reset(updateDb());
  assert.deepEqual(await patch({ checkin: '2096-04-10', checkout: '2096-04-12' }),
    { status: 200, data: { bookingId: 25, bookedRoomId: 9, status: 'Booked', updated: true } });
  assert.deepEqual(calls.at(-1).params, [25, 9, null, '2096-04-10', '2096-04-12', null]);
  assert.deepEqual(calls[0].params, [25, 4], 'A guest can only reach their own booking.');
  reset(updateDb());
  await patch({ roomId: '2', guestCount: 1 });
  assert.deepEqual(calls.at(-1).params, [25, 9, 2, null, null, 1]);
  reset(updateDb());
  await patch({ roomId: 2 }, receptionist);
  assert.deepEqual(calls[0].params, [25]);
  reset(updateDb());
  assert.equal((await patch({ checkout: '2096-03-01' })).status, 400, 'Checkout equals the stored check-in.');
  assert.ok(calls.every(c => !c.sql.startsWith('CALL')));
  await patch({ checkout: '2096-03-05' });
  assert.deepEqual(calls.at(-1).params, [25, 9, null, '2096-03-01', '2096-03-05', null]);

  // Update: malformed input, several rooms, ownership and procedure rejection.
  reset(updateDb());
  for (const body of [null, [], {}, { status: 'Cancelled' }, { roomId: 0 }, { roomId: null }, { guestCount: 1.5 },
    { checkin: 5 }, { checkin: '2096-02-30' }, { bookedRoomId: 'x', roomId: 2 }]) {
    assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  }
  assert.ok(calls.every(c => !c.sql.startsWith('CALL')));
  reset(updateDb([line, { ...line, BookedRoomID: 10 }]));
  assert.equal((await patch({ roomId: 2 })).status, 400, 'bookedRoomId is required for several rooms.');
  assert.equal((await patch({ roomId: 2, bookedRoomId: 11 })).status, 400);
  await patch({ roomId: 2, bookedRoomId: 10 });
  assert.deepEqual(calls.at(-1).params, [25, 10, 2, null, null, null]);
  reset(async () => [[]]);
  assert.equal((await patch({ roomId: 2 })).status, 404);
  assert.equal(calls.length, 1, 'Do not read rooms for a missing or foreign booking.');
  reset(async (sql, params) => { if (sql.startsWith('CALL')) throw overlap; return updateDb()(sql, params); });
  assert.equal((await patch({ roomId: 2 })).status, 409);

  console.log('PASS: multi-room booking validation, locking order, rollback and release; booking update validation, ownership and conflict handling (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });