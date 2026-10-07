const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real Express routing with fake token verification and a fake database.
// Fixtures are independent expected data; SQL shape checks are not live MySQL.
const day = '2099-01-02';
const branches = [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Kandy' }, { id: 3, name: 'Empty' }];
const rooms = [
  { id: 1, branch: 1, status: 'Occupied' }, { id: 2, branch: 1, status: 'Available' },
  { id: 3, branch: 2, status: 'Maintenance' }, { id: 4, branch: 2, status: 'Occupied' },
];
const bookings = [
  { id: 10, status: 'Checked-Out', rooms: [1, 2], arrival: day, departure: day },
  { id: 11, status: 'Checked-In', rooms: [1], arrival: day, departure: '2099-01-03' },
  { id: 12, status: 'Checked-In', rooms: [2, 3], arrival: day, departure: day },
  { id: 13, status: 'Booked', rooms: [4], arrival: '2099-01-03', departure: '2099-01-05' },
  { id: 14, status: 'Cancelled', rooms: [1], arrival: day, departure: day },
  { id: 15, status: 'Checked-Out', rooms: [], arrival: day, departure: day },
  { id: 16, status: 'Booked', rooms: [2], arrival: '2099-01-01', departure: day },
];
const payments = [
  { booking: 10, cents: 5000n, date: `${day} 00:00:00` },
  { booking: 10, cents: 5000n, date: `${day} 23:59:59.999999` },
  { booking: 11, cents: 10010n, date: `${day} 12:00:00` }, { booking: 12, cents: 3005n, date: day },
  { booking: 15, cents: 2000n, date: day },
  { booking: 13, cents: 99999n, date: '2099-01-01 23:59:59.999999' },
  { booking: 10, cents: 88888n, date: '2099-01-03 00:00:00' },
];
const money = cents => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const localRooms = branch => rooms.filter(room => branch === undefined || room.branch === branch);
function roomCounts(branch) {
  const selected = localRooms(branch);
  return { totalRooms: selected.length, occupiedRooms: selected.filter(room => room.status === 'Occupied').length,
    availableRooms: selected.filter(room => room.status === 'Available').length,
    maintenanceRooms: selected.filter(room => room.status === 'Maintenance').length };
}
function branchIds(booking) { return [...new Set(booking.rooms.map(id => rooms.find(room => room.id === id).branch))]; }
function cash(branch) {
  const selected = payments.filter(payment => {
    const ids = branchIds(bookings.find(booking => booking.id === payment.booking));
    return payment.date.slice(0, 10) === day && (branch === undefined || (ids.length === 1 && ids[0] === branch));
  });
  return { todayRevenue: money(selected.reduce((total, payment) => total + payment.cents, 0n)), todayPaymentsCount: selected.length };
}
let events, queries, scopeQueries, options;
function reset(next = {}) { events = []; queries = []; scopeQueries = []; options = next; }
const connection = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (options.failQuery && sql.includes(options.failQuery)) throw new Error('simulated query failure');
    if (sql.startsWith('SET TRANSACTION')) { assert.equal(sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); events.push('ISOLATION'); return [[]]; }
    if (sql.startsWith('START TRANSACTION')) { assert.equal(sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); events.push('BEGIN'); return [[]]; }
    assert.match(sql.trim(), /^SELECT\b/, 'Dashboard must not write hotel data.');
    const branch = params.find(value => typeof value === 'number');
    let rows;
    if (sql.includes('AS ServerToday')) rows = [{ ServerToday: day }];
    else if (sql.includes('FROM PAYMENT p')) {
      assert.match(sql, /CAST\(COALESCE\(SUM\(p\.Amount\), 0\.00\) AS CHAR\)/);
      assert.match(sql, /COUNT\(p\.PaymentID\)/);
      assert.doesNotMatch(sql, /SUM\(DISTINCT/);
      assert.match(sql, /WHERE p\.PaymentDate >= \? AND p\.PaymentDate < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
      assert.doesNotMatch(sql, /DATE\(p\.PaymentDate\)|CURDATE|CURRENT_DATE|BETWEEN|FORCE INDEX/);
      assert.deepEqual(params, [day, day, ...(branch === undefined ? [] : [branch])],
        'Reuse the captured DB day for both bounds and preserve branch parameter order.');
      if (branch !== undefined) {
        assert.match(sql, /JOIN \([\s\S]*GROUP BY br\.BookingID\s+HAVING COUNT\(DISTINCT r\.BranchID\) = 1\s*\) scope ON scope\.BookingID = p\.BookingID/);
        assert.match(sql, /MIN\(r\.BranchID\) AS BranchID/);
        assert.match(sql, /AND scope\.BranchID = \?/);
      } else assert.doesNotMatch(sql, /JOIN/);
      rows = [cash(branch)];
    } else if (sql.includes('AS scheduledToday')) {
      const arrivals = sql.includes('DATE(br.CheckInDateTime)');
      assert.match(sql, /COUNT\(DISTINCT br\.BookingID\)/);
      if (arrivals) assert.match(sql, /BookingStatus IN \('Checked-In', 'Checked-Out'\)/);
      const selected = bookings.filter(booking => booking.status !== 'Cancelled' && booking.rooms.length
        && booking[arrivals ? 'arrival' : 'departure'] === day
        && (branch === undefined || branchIds(booking).includes(branch)));
      rows = [{ scheduledToday: selected.length, completedToday: selected.filter(booking =>
        arrivals ? ['Checked-In', 'Checked-Out'].includes(booking.status) : booking.status === 'Checked-Out').length }];
    } else if (sql.includes('AS activeBookings')) {
      rows = [{ activeBookings: bookings.filter(booking => ['Booked', 'Checked-In'].includes(booking.status)
        && (branch === undefined || branchIds(booking).includes(branch))).length }];
    } else if (sql.includes('FROM BRANCH b')) rows = branches.map(branch => ({ BranchID: branch.id, BranchName: branch.name, ...roomCounts(branch.id) }));
    else if (sql.includes('FROM ROOM r')) rows = [roomCounts(branch)];
    else throw new Error(`Unexpected query: ${sql}`);
    if (/DATE\((?:br|p)\./.test(sql)) {
      assert.equal(params[0], day, 'Reuse the captured DB day for every dated query.');
      assert.doesNotMatch(sql, /CURDATE|CURRENT_DATE/);
    }
    return [options.rows ? options.rows(sql, rows) : rows];
  },
  async commit() { events.push('COMMIT'); if (options.failCommit) throw new Error('simulated commit failure'); },
  async rollback() { events.push('ROLLBACK'); if (options.failRollback) throw new Error('simulated rollback failure'); },
  release() { events.push('RELEASE'); },
};
const pool = { async execute(sql, params) {
  scopeQueries.push({ sql, params });
  assert.match(sql, /FROM STAFF s JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID/);
  assert.match(sql, /LEFT JOIN BRANCH b ON b.BranchID = s.BranchID WHERE s.StaffID = \?/);
  if (options.failScope) throw new Error('Private staff database failure');
  const currentStaff = [
    { StaffID: 1, Role: 'Admin', BranchID: null, BranchName: null },
    { StaffID: 2, Role: 'Manager', BranchID: 1, BranchName: 'Colombo' },
  ].find(staff => staff.StaffID === params[0]);
  return [options.missingStaff || !currentStaff ? [] : [{ ...currentStaff, ...options.staffOverride }]];
}, async getConnection() {
  events.push('CONNECT'); if (options.failConnect) throw new Error('simulated acquisition failure'); return connection;
} };
require.cache[require.resolve('../config/db')] = { exports: pool };
const { getAdminDashboardSummary } = require('../controllers/dashboardController');
const manager = { type: 'staff', id: 2, role: 'Manager', branchId: 1 };
function invoke(query = {}, user = manager) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.code = code; return this; },
      json(data) { resolve({ code: this.code, data, headers: this.headers }); return this; } };
    getAdminDashboardSummary({ query, user }, res, reject);
  });
}
async function routeChecks() {
  const tokens = { manager, admin: { type: 'staff', id: 1, role: 'Admin', branchId: null },
    guest: { type: 'guest', id: 1 }, receptionist: { type: 'staff', id: 3, role: 'Receptionist' },
    service: { type: 'staff', id: 4, role: 'ServiceStaff' }, malformed: { ...manager, id: '2' } };
  require.cache[require.resolve('../config/auth')] = { exports: { verifyAccessToken(token) {
    if (!Object.hasOwn(tokens, token)) throw new Error('Invalid test token'); return tokens[token];
  } } };
  const express = require('express'); const http = require('node:http'); const app = express();
  const router = require('../routes/dashboardRoutes');
  app.use('/api/dashboard', router); app.use('/dashboard', router);
  app.use((error, req, res, next) => { void error; void req; void next; res.status(500).json({ error: 'Dashboard unavailable.' }); });
  const request = (url, token) => new Promise((resolve, reject) => {
    const req = new http.IncomingMessage(null); req.method = 'GET'; req.url = url;
    req.headers = token ? { authorization: `Bearer ${token}` } : {};
    const res = new http.ServerResponse(req);
    res.end = function(chunk) { try { resolve({ code: this.statusCode, data: JSON.parse(String(chunk)) }); } catch (error) { reject(error); } return this; };
    app.handle(req, res);
  });
  for (const prefix of ['/api/dashboard/admin', '/dashboard/admin']) {
    for (const [token, expected] of [[null, 401], ['invalid', 401], ['guest', 403], ['receptionist', 403], ['service', 403], ['malformed', 401]]) {
      reset(); assert.equal((await request(prefix, token)).code, expected); assert.equal(events.length, 0); assert.equal(scopeQueries.length, 0);
    }
    for (const token of ['manager', 'admin']) { reset(); assert.equal((await request(prefix, token)).code, 200); }
    for (const changed of [{ staffOverride: { Role: 'Receptionist' } }, { staffOverride: { Role: 'Admin' } },
      { staffOverride: { BranchID: 2 } }, { missingStaff: true }]) {
      reset(changed);
      const response = await request(prefix, 'manager');
      assert.equal(response.code, 401, 'Stale manager identity cannot read the dashboard.');
      assert.deepEqual(response.data, { error: 'Your staff access has changed. Please sign in again.' });
      assert.equal(scopeQueries.length, 1); assert.equal(queries.length, 0); assert.equal(events.length, 0);
    }
    reset({ failScope: true });
    assert.deepEqual(await request(prefix, 'manager'), { code: 500, data: { error: 'Dashboard unavailable.' } });
    assert.equal(queries.length, 0); assert.equal(events.length, 0);
    for (const suffix of ['?branchId=1x', '?branchId=1&branchId=2', '?branchId[x]=1', '?other=1']) {
      reset(); assert.equal((await request(prefix + suffix, 'manager')).code, 400); assert.equal(events.length, 0);
    }
    reset({ failQuery: 'FROM PAYMENT' }); assert.equal((await request(prefix, 'manager')).code, 500);
  }
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/dashboard', dashboardRoutes\)/);
  assert.match(server, /app\.use\('\/dashboard', dashboardRoutes\)/);
}
(async () => {
  for (const query of [null, [], { other: '1' }, ...['', '0', '-1', '01', ' 1', '1.5', '1e3', '1abc', '2147483648', ['1','2'], {}, undefined].map(branchId => ({ branchId }))]) {
    reset(); assert.equal((await invoke(query)).code, 400); assert.equal(events.length, 0);
  }
  for (const user of [null, { ...manager, id: 0 }, { ...manager, id: 2147483648 }, { ...manager, id: '2' }, { type: 'guest', id: 1, role: 'Admin' }]) {
    reset(); assert.equal((await invoke({}, user)).code, 403); assert.equal(events.length, 0);
  }
  reset(); const all = await invoke();
  assert.equal(all.headers['Cache-Control'], 'no-store'); assert.equal(all.data.date, day);
  assert.deepEqual(all.data.summary, { todayCheckIns: 3, todayCompletedCheckIns: 3, todayCheckOuts: 3,
    todayCompletedCheckOuts: 1, todayRevenue: '250.15', todayPaymentsCount: 5,
    currentOccupancyPercentage: 50, totalRooms: 4, occupiedRooms: 2, availableRooms: 1, maintenanceRooms: 1, activeBookings: 4 });
  assert.equal(all.data.branchBreakdown[2].occupancyPercentage, null);
  assert.deepEqual(events, ['CONNECT', 'ISOLATION', 'BEGIN', 'COMMIT', 'RELEASE']);
  assert.equal(queries.filter(query => query.sql.includes('CURDATE')).length, 1);
  reset(); const branch = (await invoke({ branchId: '1' })).data;
  assert.equal(branch.summary.todayRevenue, '200.10'); assert.equal(branch.summary.todayPaymentsCount, 3);
  assert.equal(branch.branchBreakdown, undefined); assert.equal(branch.branchId, 1);
  for (const branchId of ['2', '3', '2147483647']) {
    reset(); const data = (await invoke({ branchId })).data;
    assert.equal(data.summary.todayRevenue, '0.00'); assert.equal(data.summary.todayPaymentsCount, 0);
    if (branchId !== '2') assert.equal(data.summary.currentOccupancyPercentage, null);
  }
  reset({ rows: (sql, rows) => sql.includes('FROM PAYMENT') ? [{ todayRevenue: '9007199254740993.01', todayPaymentsCount: 1 }] : rows });
  assert.equal((await invoke()).data.summary.todayRevenue, '9007199254740993.01', 'Preserve exact SQL decimals.');
  for (const bad of [null, NaN, -1, 'invalid', '9007199254740992']) {
    reset({ rows: (sql, rows) => sql.includes('FROM ROOM r') ? [{ ...rows[0], totalRooms: bad }] : rows });
    await assert.rejects(invoke(), /invalid dashboard count/); assert.deepEqual(events.slice(-2), ['ROLLBACK','RELEASE']);
  }
  for (const options of [{ failConnect: true }, { failQuery: 'FROM PAYMENT' }, { failCommit: true }, { failQuery: 'FROM PAYMENT', failRollback: true }]) {
    reset(options); await assert.rejects(invoke(), /simulated (acquisition|query|commit) failure/);
    if (!options.failConnect) assert.deepEqual(events.slice(-2), ['ROLLBACK','RELEASE']);
  }
  await routeChecks();
  console.log('PASS: real dashboard route authorization and current staff identity checks, strict filters before dashboard SQL, one read-only snapshot and DB date, indexable payment day bounds, exact cash totals/one-booking branch attribution, scheduled-status counts, empty branches and connection/error handling (mock database; no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
