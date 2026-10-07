const assert = require('node:assert/strict');
const express = require('express');

// Real Express middleware/routes/controllers, independent in-memory records and
// explicit SQL contracts. These tests never connect to MySQL.
const tokens = {
  front: { type: 'staff', id: 3, role: 'Receptionist', branchId: 1 },
  service: { type: 'staff', id: 4, role: 'ServiceStaff', branchId: 1 },
  manager: { type: 'staff', id: 5, role: 'Manager', branchId: 1 },
  admin: { type: 'staff', id: 6, role: 'Admin', branchId: null },
  guest: { type: 'guest', id: 11 },
};
const roomRows = [
  { RoomID: 102, BranchID: 1, RoomNumber: '102', RoomStatus: 'Available', Capacity: 2 },
  { RoomID: 101, BranchID: 1, RoomNumber: '101', RoomStatus: 'Available', Capacity: 2 },
  { RoomID: 201, BranchID: 2, RoomNumber: '201', RoomStatus: 'Available', Capacity: 2 },
];
const headers = [
  { BookingID: 20, GuestID: 11, BookingStatus: 'Booked', roomIds: [101] },
  { BookingID: 21, GuestID: 12, BookingStatus: 'Booked', roomIds: [201] },
  { BookingID: 22, GuestID: 11, BookingStatus: 'Booked', roomIds: [101, 201] },
  { BookingID: 23, GuestID: 11, BookingStatus: 'Booked', roomIds: [] },
  { BookingID: 24, GuestID: 11, BookingStatus: 'Booked', roomIds: [999] },
];
let state, queries, events, options;
function reset(next = {}) {
  state = { staff: Object.values(tokens).filter(t => t.type === 'staff').map(t => ({ StaffID: t.id, Role: t.role,
    BranchID: t.branchId, BranchName: t.branchId === null ? null : 'Colombo' })), rooms: structuredClone(roomRows), bookings: structuredClone(headers) };
  queries = []; events = []; options = next;
}
function allowed(sql, params, booking, data) {
  if (!booking) return false;
  if (sql.includes('scope_staff')) {
    assert.match(sql, /JOIN STAFF_ACCOUNT scope_account ON scope_account.StaffID = scope_staff.StaffID/);
    assert.match(sql, /scope_staff\.Role = \? AND scope_staff\.BranchID <=> \?/);
    const roleAt = params.findIndex(p => ['Admin', 'Manager', 'Receptionist', 'ServiceStaff'].includes(p));
    assert.ok(roleAt > 0);
    const [id, role, branch] = params.slice(roleAt - 1, roleAt + 2);
    const current = data.staff.find(s => s.StaffID === id);
    if (!current || current.Role !== role || current.BranchID !== branch) return false;
    if (['Receptionist', 'ServiceStaff'].includes(role)) {
      assert.match(sql, /EXISTS \(SELECT 1 FROM BOOKED_ROOMS scope_nonempty/);
      assert.match(sql, /NOT EXISTS \(SELECT 1 FROM BOOKED_ROOMS scope_br/);
      assert.match(sql, /scope_room\.RoomID IS NULL OR scope_room\.BranchID <> \?/);
      assert.equal(params[roleAt + 2], branch);
      return booking.roomIds.length > 0 && booking.roomIds.every(id => data.rooms.find(r => r.RoomID === id)?.BranchID === branch);
    }
    assert.doesNotMatch(sql, /scope_nonempty|scope_br/);
    return true;
  }
  assert.match(sql, /(?:b\.|BOOKING\.)?GuestID = \?/);
  return booking.GuestID === params.at(-1);
}
function makeConnection() {
  let snapshot;
  return {
    async query(sql, params = []) { return this.execute(sql, params); },
    async execute(sql, params = []) {
      queries.push({ sql, params, snapshot: !!snapshot });
      if (sql.startsWith('SET TRANSACTION')) { events.push('ISOLATION'); return [[]]; }
      if (sql.startsWith('START TRANSACTION')) {
        assert.equal(sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        snapshot = structuredClone(state); events.push('READ BEGIN'); return [[]];
      }
      const data = snapshot || state;
      if ((/FROM STAFF s\s/.test(sql))) {
        if (options.failScope) throw Object.assign(new Error('private database detail'), { code: 'ER_TEST' });
        return [data.staff.filter(s => s.StaffID === params[0])];
      }
      if (sql.startsWith('CALL ')) {
        assert.equal(snapshot, undefined, 'No business CALL may run inside a read transaction.');
        if (options.procedureError) throw options.procedureError;
        return [[]];
      }
      if (sql === 'SELECT @p_booking_id') return [[{ '@p_booking_id': 50 }]];
      if (sql.startsWith('SET @p_booking_id')) return [[]];
      if (sql.startsWith('INSERT INTO BOOKING')) return [{ insertId: 50 }];
      if (sql.startsWith('INSERT INTO BOOKED_ROOMS')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM ROOM r') && !sql.includes('FROM BOOKED_ROOMS')) {
        const room = data.rooms.find(r => r.RoomID === params[0]);
        if (sql.includes('scope_staff')) {
          assert.match(sql, /r\.BranchID = \?/);
          return [room && room.BranchID === params.at(-1) ? [room] : []];
        }
        return [room ? [room] : []];
      }
      if (sql.includes('FROM BOOKED_ROOMS br') && sql.endsWith('FOR SHARE')) {
        const active = data.bookings.find(b => ['Booked', 'Checked-In'].includes(b.BookingStatus) && b.roomIds.includes(params[0]));
        return [options.roomStatusGuard && active ? [{ BookedRoomID: 1 }] : []];
      }
      if (sql === 'SELECT RoomID, BranchID FROM ROOM WHERE RoomID = ? FOR UPDATE') {
        return [data.rooms.filter(r => r.RoomID === params[0])];
      }
      if (sql === 'UPDATE ROOM SET RoomStatus = ? WHERE RoomID = ?') {
        if (options.failRoomUpdate) throw Object.assign(new Error('private error'), { code: 'ER_LOCK_DEADLOCK' });
        const room = data.rooms.find(r => r.RoomID === params[1]);
        room.RoomStatus = params[0]; return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE BOOKING')) {
        const booking = data.bookings.find(b => b.BookingID === params[0]);
        assert.match(sql, /BookingStatus = 'Booked'/);
        assert.doesNotMatch(sql, /\bROOM\b|scope_staff|scope_br/, 'The invoking UPDATE must not read the ROOM table written by its trigger.');
        const owns = !sql.includes('GuestID') || booking?.GuestID === params[1];
        const ok = owns && booking?.BookingStatus === 'Booked';
        if (ok) booking.BookingStatus = 'Cancelled';
        return [{ affectedRows: ok ? 1 : 0 }];
      }
      if (sql.includes('FROM BOOKING')) {
        let bookings = sql.includes('SELECT DISTINCT') ? data.bookings : data.bookings.filter(b => b.BookingID === params[0]);
        bookings = sql.endsWith('FOR UPDATE')
          ? bookings.filter(b => !sql.includes('GuestID') || b.GuestID === params[1])
          : bookings.filter(b => allowed(sql, params, b, data));
        if (sql.includes('r.BranchID = ?') && sql.includes('SELECT DISTINCT')) {
          const filterBranch = params[0];
          bookings = bookings.filter(b => b.roomIds.some(id => data.rooms.find(r => r.RoomID === id)?.BranchID === filterBranch));
        }
        const rows = bookings.map(b => ({ BookingID: b.BookingID, GuestID: b.GuestID, BookingStatus: b.BookingStatus,
          ServerToday: '2099-01-02', GuestName: `Guest ${b.GuestID}`, GuestIDNumber: `ID-${b.GuestID}` }));
        if (options.moveAfterHeader && rows.length) { state.bookings.find(b => b.BookingID === 20).roomIds = [201]; options.moveAfterHeader = false; }
        return [rows];
      }
      if (sql.includes('FROM BOOKED_ROOMS br') || sql.includes('FROM BOOKED_ROOMS WHERE')) {
        const selected = data.bookings.filter(b => params.includes(b.BookingID));
        return [selected.flatMap(b => b.roomIds.map((id, i) => ({ ...data.rooms.find(r => r.RoomID === id), BookingID: b.BookingID,
          BookedRoomID: i + 1, GuestCount: 1, CheckInDate: '2099-01-02', CheckOutDate: '2099-01-04' })))];
      }
      if (sql.includes('FROM SERVICE_USAGE')) return [[{ UsageID: 7, BookingID: params[0], ServiceName: 'Breakfast', Quantity: 1, PriceAtUsage: '1500.00' }]];
      if (sql.includes('FROM BILL')) return [[{ BillID: 1, RoomCharges: '100.00', ServiceCharges: '0.00', TotalAmount: '100.00', BillStatus: 'Unpaid' }]];
      if (sql.includes('FROM PAYMENT')) return [[]];
      throw new Error(`Unhandled mock SQL: ${sql}`);
    },
    async beginTransaction() { events.push('WRITE BEGIN'); },
    async commit() { events.push('COMMIT'); snapshot = undefined; },
    async rollback() { events.push('ROLLBACK'); snapshot = undefined; },
    release() { events.push('RELEASE'); },
  };
}
const poolConnection = makeConnection();
const pool = { execute: poolConnection.execute.bind(poolConnection), query: poolConnection.query.bind(poolConnection),
  getConnection: async () => { events.push('CONNECT'); return makeConnection(); } };
require.cache[require.resolve('../config/db')] = { exports: pool };
require.cache[require.resolve('../config/auth')] = { exports: { verifyAccessToken(token) {
  if (!tokens[token]) throw new Error('bad token'); return { ...tokens[token] };
} } };
const app = express(); app.use(express.json());
app.use('/api/staff', require('../routes/staffRoutes'));
app.use('/api/bookings', require('../routes/bookingRoutes'));
app.use('/api', require('../routes/billRoutes'));
app.use('/api', require('../routes/serviceRoutes'));
app.use('/api', require('../routes/roomRoutes'));
app.use((err, req, res, next) => res.status(500).json({ error: 'Unexpected server error.' }));
const server = app.listen(0, '127.0.0.1');
async function request(path, token = 'front', method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
(async () => {
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  reset(); assert.equal((await request('/staff/scope', null)).status, 401);
  assert.equal((await request('/staff/scope', 'guest')).status, 403);
  assert.deepEqual((await request('/staff/scope')).data, { staffId: 3, role: 'Receptionist', branchId: 1, branchName: 'Colombo' });
  assert.deepEqual((await request('/staff/scope', 'admin')).data, { staffId: 6, role: 'Admin', branchId: null, branchName: null });
  for (const change of [{ Role: 'Manager' }, { BranchID: 2 }, { StaffID: 99 }]) {
    reset(); Object.assign(state.staff[0], change); assert.equal((await request('/staff/scope')).status, 401);
  }
  tokens.unassigned = { ...tokens.front, branchId: null };
  reset(); state.staff[0].BranchID = null; state.staff[0].BranchName = null;
  assert.equal((await request('/staff/scope', 'unassigned')).status, 403);
  for (const branchId of [undefined, '1', 0, -1]) {
    tokens.bad = { ...tokens.front, branchId }; reset(); assert.equal((await request('/staff/scope', 'bad')).status, 401);
    assert.equal(queries.length, 0, 'Malformed token scopes never query MySQL.');
  }
  reset({ failScope: true }); assert.equal((await request('/staff/scope')).status, 500);

  for (const token of ['front', 'service']) {
    reset(); assert.deepEqual((await request('/bookings', token)).data.map(b => b.BookingID), [20]);
    reset(); assert.deepEqual((await request('/bookings?branchId=2', token)).data, [], 'Query branch never expands assigned scope.');
    for (const id of [21, 22, 23, 24, 999]) {
      for (const path of [`/bookings/${id}`, `/bookings/${id}/bill`, `/service-usage/${id}`]) {
        reset(); assert.deepEqual(await request(path, token), { status: 404, data: { error: 'Booking not found.' } });
        assert.ok(!queries.some(q => /^SELECT su\.|^SELECT \* FROM BILL|^SELECT p\./.test(q.sql)));
      }
    }
    reset(); assert.equal((await request('/bookings/20/bill', token)).status, 200);
    reset(); assert.equal((await request('/service-usage/20', token)).status, 200);
  }
  for (const token of ['manager', 'admin']) {
    reset(); assert.deepEqual((await request('/bookings', token)).data.map(b => b.BookingID), [20, 21, 22, 23, 24]);
    reset(); assert.equal((await request('/bookings/22', token)).status, 200);
  }
  reset(); assert.equal((await request('/bookings/21', 'guest')).status, 404);
  reset(); assert.equal((await request('/bookings/22', 'guest')).status, 200, 'Guest ownership remains independent of branch.');
  reset({ moveAfterHeader: true }); const consistent = await request('/bookings/20');
  assert.equal(consistent.status, 200); assert.equal(consistent.data.rooms[0].BranchID, 1);
  assert.equal(state.bookings[0].roomIds[0], 201, 'Concurrent edit changes live state, not the captured read snapshot.');
  assert.deepEqual(events, ['CONNECT', 'ISOLATION', 'READ BEGIN', 'COMMIT', 'RELEASE']);

  const stay = { guestId: 11, roomId: 201, checkin: '2099-01-02', checkout: '2099-01-04', guestCount: 1, paymentMethod: 'Cash' };
  for (const [path, method, body] of [
    ['/bookings', 'POST', stay],
    ['/bookings/21', 'PATCH', { roomId: 101 }],
    ['/bookings/21/cancel', 'PATCH', {}],
    ['/bookings/21/check-in', 'POST', {}],
    ['/bookings/21/check-out', 'POST', {}],
    ['/payments', 'POST', { bookingId: 21, amount: '1.00', paymentMethod: 'Cash' }],
    ['/service-usage', 'POST', { bookingId: 21, serviceId: 1, quantity: 1 }],
  ]) {
    reset(); assert.equal((await request(path, 'front', method, body)).status, 404, path);
    assert.ok(!queries.some(q => q.sql.startsWith('CALL ')), 'Foreign booking requests never reach mutation routines.');
  }
  reset(); assert.equal((await request('/bookings/20', 'front', 'PATCH', { roomId: 201 })).status, 404);
  assert.ok(!queries.some(q => q.sql.startsWith('CALL ')));
  reset(); assert.equal((await request('/bookings', 'front', 'POST', { ...stay, rooms: [{ roomId: 101, guestCount: 1 }, { roomId: 201, guestCount: 1 }] })).status, 404);
  assert.ok(!queries.some(q => q.sql.startsWith('INSERT ')), 'Mixed selection rolls back before any booking insertion.');
  assert.deepEqual(events, ['CONNECT', 'WRITE BEGIN', 'ROLLBACK', 'RELEASE']);
  reset(); assert.equal((await request('/bookings/20/cancel', 'front', 'PATCH', {})).status, 200);
  assert.equal(state.bookings[0].BookingStatus, 'Cancelled');
  const cancelQueries = queries.map(q => q.sql);
  assert.match(cancelQueries[1], /FROM BOOKING .* FOR UPDATE$/);
  assert.match(cancelQueries[2], /FROM STAFF s[\s\S]*FOR SHARE$/);
  assert.match(cancelQueries[3], /FROM BOOKED_ROOMS br[\s\S]*FOR SHARE OF br$/);
  assert.match(cancelQueries[4], /^UPDATE BOOKING/);
  assert.deepEqual(events, ['CONNECT', 'WRITE BEGIN', 'COMMIT', 'RELEASE']);
  for (const id of [22, 23, 24]) {
    reset(); assert.equal((await request(`/bookings/${id}/cancel`, 'front', 'PATCH', {})).status, 404);
    assert.ok(!queries.some(q => q.sql.startsWith('UPDATE ')));
    assert.deepEqual(events, ['CONNECT', 'WRITE BEGIN', 'ROLLBACK', 'RELEASE']);
  }
  reset(); assert.equal((await request('/bookings/21/cancel', 'manager', 'PATCH', {})).status, 200);
  reset(); assert.equal((await request('/bookings/20/cancel', 'guest', 'PATCH', {})).status, 200);
  reset(); assert.equal((await request('/bookings/21/cancel', 'guest', 'PATCH', {})).status, 404);

  for (const id of [201, 999]) {
    reset(); assert.deepEqual(await request(`/rooms/${id}/status`, 'front', 'PATCH', { roomStatus: 'Maintenance' }),
      { status: 404, data: { error: 'Room not found.' } });
    assert.ok(!queries.some(q => q.sql.startsWith('UPDATE ')));
  }
  reset(); assert.equal((await request('/rooms/102/status', 'service', 'PATCH', { roomStatus: 'Maintenance' })).status, 403);
  reset(); assert.equal((await request('/rooms/102/status', 'guest', 'PATCH', { roomStatus: 'Maintenance' })).status, 403);
  reset({ roomStatusGuard: true });
  assert.equal((await request('/rooms/101/status', 'front', 'PATCH', { roomStatus: 'Maintenance' })).status, 409,
    'Existing active-booking maintenance protection is preserved.');
  assert.equal(state.rooms.find(r => r.RoomID === 101).RoomStatus, 'Available');
  reset({ roomStatusGuard: true });
  assert.deepEqual(await request('/rooms/102/status', 'front', 'PATCH', { roomStatus: 'Maintenance' }),
    { status: 200, data: { roomId: 102, roomStatus: 'Maintenance' } });
  assert.equal(state.rooms.find(r => r.RoomID === 102).RoomStatus, 'Maintenance');
  const roomQueries = queries.map(q => q.sql);
  assert.match(roomQueries[1], /FROM STAFF s[\s\S]*FOR SHARE$/);
  assert.match(roomQueries[2], /FROM ROOM WHERE RoomID = \? FOR UPDATE$/);
  assert.match(roomQueries[3], /FROM BOOKED_ROOMS br[\s\S]*FOR SHARE$/);
  assert.match(roomQueries[4], /^UPDATE ROOM/);
  assert.deepEqual(events, ['CONNECT', 'WRITE BEGIN', 'COMMIT', 'RELEASE']);
  reset(); assert.equal((await request('/rooms/201/status', 'manager', 'PATCH', { roomStatus: 'Available' })).status, 200);
  reset({ failRoomUpdate: true }); assert.equal((await request('/rooms/102/status', 'front', 'PATCH', { roomStatus: 'Occupied' })).status, 409);
  assert.deepEqual(events, ['CONNECT', 'WRITE BEGIN', 'ROLLBACK', 'RELEASE']);
  for (const methodPath of [['POST', '/bookings/20/check-in'], ['POST', '/bookings/20/check-out'], ['PATCH', '/bookings/20/cancel']]) {
    reset(); assert.equal((await request(methodPath[1], 'service', methodPath[0], {})).status, 403);
  }
  for (const [sqlState, expected] of [['45003', 404], ['45004', 403]]) {
    reset({ procedureError: { sqlState, sqlMessage: 'private foreign branch data' } });
    const result = await request('/bookings/20/check-in', 'front', 'POST', {});
    assert.equal(result.status, expected); assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal(queries.filter(q => q.sql.startsWith('CALL')).length, 1);
  }
  // A new route that omits the resolver still fails closed at controller entry.
  const ctrl = require('../controllers/bookingController');
  for (const action of ['listBookings', 'getBooking', 'makeBooking', 'updateBooking', 'cancelBooking', 'checkIn', 'checkOut']) {
    reset(); const result = await new Promise((resolve, reject) => ctrl[action]({ user: tokens.front, params: { id: '20' }, query: {}, body: stay },
      { status(code) { this.code = code; return this; }, json(data) { resolve({ code: this.code, data }); } }, reject));
    assert.equal(result.code, 403); assert.equal(queries.length, 0);
  }
  console.log('PASS: real routes resolve current staff accounts; stale/null/malformed scopes; all-room/nonempty branch access; fixed branch filters; read snapshots; scoped writes, trigger-compatible locked cancellation and room status; mixed-room rollback; SQL denial mapping and fail-closed controller entry (mock MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
