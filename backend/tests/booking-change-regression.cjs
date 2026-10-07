const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
const single = { paymentMethod: 'Card', checkin: '2096-03-01', checkout: '2096-03-03',
  roomId: 7, guestCount: 1 };
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
  for (const rooms of [null, undefined, {}, '7', 7, false]) {
    assert.equal((await invoke('makeBooking', { body: { ...single, rooms } })).status, 400,
      'A malformed rooms field must not fall back to the otherwise valid single-room request.');
  }
  assert.equal((await invoke('makeBooking', { body: { ...multi, checkin: '2000-01-01' } })).status, 400);
  assert.equal((await invoke('makeBooking', { user: receptionist })).status, 400, 'Staff must name the guest.');
  assert.equal((await invoke('makeBooking', { user: { type: 'staff', id: 2, role: 'ServiceStaff' } })).status, 403);
  assert.equal((await invoke('makeBooking', { body: null })).status, 400, 'A null body must not crash the dispatcher.');
  for (const user of [{ type: 'staff', id: 2, role: 'ServiceStaff' }, { type: 'guest', id: 0 }]) {
    assert.equal((await patch({ roomId: 2 }, user)).status, 403);
  }
  assert.equal(calls.length + events.length, 0);

  // Omitting rooms still uses the original single-room stored procedure.
  reset(async sql => sql === 'SELECT @p_booking_id' ? [[{ '@p_booking_id': 56 }]] : [{}]);
  assert.deepEqual(await invoke('makeBooking', { body: single }),
    { status: 201, data: { bookingId: 56, status: 'Booked' } });
  assert.deepEqual(calls.find(call => call.sql.startsWith('CALL sp_make_booking')).params,
    [4, null, 7, single.checkin, single.checkout, 1, 'Card']);
  assert.deepEqual(events, ['CONNECT', 'RELEASE']);

  // Success: guest identity from the token, rooms locked in ascending order, one commit.
  reset(roomDb());
  assert.deepEqual(await invoke('makeBooking', { body: { ...multi, guestId: 999 } }),
    { status: 201, data: { bookingId: 55, status: 'Booked', rooms: 2 } });
  assert.deepEqual(events, ['CONNECT', 'BEGIN', 'COMMIT', 'RELEASE']);
  assert.deepEqual(calls.find(c => c.sql.startsWith('INSERT INTO BOOKING ')).params, [4, null, 'Card']);
  assert.deepEqual(calls.filter(c => c.sql.includes('FOR UPDATE OF r')).map(c => c.params[0]), [4, 7]);
  for (const roomId of [4, 7]) {
    const roomLockAt = calls.findIndex(c => c.sql.includes('FROM ROOM r') && c.params[0] === roomId);
    const overlapAt = calls.findIndex(c => c.sql.includes('FROM BOOKED_ROOMS br') && c.params[0] === roomId);
    const insertAt = calls.findIndex(c => c.sql.includes('INSERT INTO BOOKED_ROOMS') && c.params[1] === roomId);
    assert.ok(roomLockAt < overlapAt && overlapAt < insertAt,
      'Hold the exclusive room lock before the current overlap read and insertion.');
    assert.match(calls[overlapAt].sql, /LIMIT 1 FOR SHARE$/,
      'Availability needs a current locking read, without BOOKED_ROOMS UPDATE privileges.');
    assert.deepEqual(calls[overlapAt].params, [roomId, multi.checkin, multi.checkout]);
  }
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
  assert.deepEqual(calls.at(-1).params, [25, 9, null, null, '2096-03-05', null]);

  // Both requests read the same old dates before either reaches the locked
  // procedure. The fake procedure preserves each omitted field, just as its
  // NULL-parameter contract does. Neither PATCH may undo the other's edit.
  let dateReads = 0;
  let releaseDateReads;
  const bothDatesRead = new Promise(resolve => { releaseDateReads = resolve; });
  const savedDates = { checkin: line.CheckInDate, checkout: line.CheckOutDate };
  reset(async (sql, params) => {
    if (sql.includes('FROM BOOKING WHERE')) return [[{ BookingID: 25 }]];
    if (sql.includes('FROM BOOKED_ROOMS WHERE')) {
      const snapshot = { ...line, CheckInDate: savedDates.checkin, CheckOutDate: savedDates.checkout };
      dateReads++;
      if (dateReads === 2) releaseDateReads();
      await bothDatesRead;
      return [[snapshot]];
    }
    assert.ok(sql.startsWith('CALL sp_update_booked_room'), 'Unexpected query in concurrent date test.');
    if (params[3] !== null) savedDates.checkin = params[3];
    if (params[4] !== null) savedDates.checkout = params[4];
    return [[]];
  });
  const updates = await Promise.all([
    patch({ checkin: '2096-03-02' }),
    patch({ checkout: '2096-03-05' }),
  ]);
  assert.deepEqual(updates.map(result => result.status), [200, 200]);
  assert.equal(dateReads, 2);
  assert.deepEqual(savedDates, { checkin: '2096-03-02', checkout: '2096-03-05' },
    'Omitted dates must preserve the other committed edit, not overwrite it with a preflight snapshot.');

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

  // Multi-room FOR SHARE relies on the same exclusive target-room lock in the
  // single-room and edit procedures. Guard that cross-path schema contract;
  // these static checks do not simulate InnoDB scheduling or privilege checks.
  const schema = fs.readFileSync(path.join(__dirname, '../Database/schema.sql'), 'utf8');
  for (const name of ['sp_make_booking', 'sp_update_booked_room']) {
    const start = schema.indexOf(`CREATE PROCEDURE ${name}(`);
    assert.ok(start >= 0);
    const routine = schema.slice(start, schema.indexOf('END //', start));
    const targetRoomLock = routine.match(/FROM ROOM r[\s\S]*?WHERE r\.RoomID = (?:p_room_id|v_room)\s+FOR UPDATE(?: OF r)?;/);
    assert.ok(targetRoomLock, `${name} must exclusively lock the destination room.`);
    const overlapAt = routine.indexOf('SELECT br.BookedRoomID INTO v_conflict');
    const writeAt = routine.search(/(?:INSERT INTO|UPDATE) BOOKED_ROOMS\b/);
    assert.ok(targetRoomLock.index < overlapAt && overlapAt < writeAt);
    assert.ok(routine.indexOf('COMMIT;') > writeAt, 'The room lock must be held through the write.');
  }

  console.log('PASS: strict single/multi-room dispatch, exclusive room/shared overlap lock ordering, rollback and release; cross-path room-lock SQL contracts; booking update validation, ownership, concurrent partial-date preservation and conflicts (mock database/static SQL; no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
