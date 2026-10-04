const assert = require('node:assert/strict');
const { canReadReports, validateReportQuery } = require('../utils/reportValidation');

// Controller/SQL contracts with an independent fixture model. No MySQL server
// is contacted: these fixtures do not claim to execute or validate MySQL SQL.
const queries = [];
let databaseError;
let overrideRows;
const manager = { type: 'staff', id: 2, role: 'Manager' };
const admin = { type: 'staff', id: 1, role: 'Admin' };
const branches = [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Kandy' }, { id: 3, name: 'Empty branch' }];
const rooms = [
  { id: 1, branch: 1, status: 'Occupied' },
  { id: 2, branch: 1, status: 'Available' },
  { id: 3, branch: 2, status: 'Maintenance' },
];
const bookings = [
  { id: 10, status: 'Checked-Out', rooms: [1, 2], room: '100.00', services: '10.00', total: '110.00', payments: ['30.00', '80.00'], billStatus: 'Paid' },
  { id: 11, status: 'Checked-Out', rooms: [1], room: '100.00', services: '10.00', total: '110.00', payments: ['10.00'], billStatus: 'Paid' },
  { id: 12, status: 'Checked-In', rooms: [3], room: '100.00', services: '30.00', total: '130.00', payments: [], billStatus: 'Unpaid' },
  { id: 13, status: 'Checked-Out', rooms: [1, 3], room: '200.00', services: '40.00', total: '240.00', payments: ['241.00'], billStatus: 'Paid' },
  { id: 14, status: 'Checked-Out', rooms: [], room: '300.00', services: '0.00', total: '300.00', payments: [], billStatus: 'Unpaid' },
  { id: 15, status: 'Checked-Out', rooms: [3], room: '0.10', services: '0.20', total: '0.30', payments: ['0.30'], billStatus: 'Paid' },
];
const usage = [
  { booking: 10, service: 1, quantity: 2, savedPrice: '1.10' },
  { booking: 11, service: 1, quantity: 1, savedPrice: '1.10' },
  { booking: 12, service: 2, quantity: 1, savedPrice: '9.90' },
  { booking: 13, service: 1, quantity: 3, savedPrice: '1.10' },
  { booking: 14, service: 2, quantity: 1, savedPrice: '0.01' },
  { booking: 15, service: 3, quantity: 1, savedPrice: '4.00' },
  { booking: 15, service: 3, quantity: 1, savedPrice: '4.00' },
];
const catalogue = [
  { id: 1, name: 'Laundry', currentPrice: '999.00', active: false },
  { id: 2, name: 'Spa', currentPrice: '888.00', active: true },
  { id: 3, name: 'Minibar', currentPrice: '777.00', active: true },
];
function cents(value) { return BigInt(value.replace('.', '')); }
function money(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function branchScope(booking) {
  const ids = [...new Set(booking.rooms.map(id => rooms.find(room => room.id === id).branch))];
  return ids.length === 1
    ? { BranchID: ids[0], BranchName: branches.find(branch => branch.id === ids[0]).name, BranchScope: 'single' }
    : { BranchID: null, BranchName: ids.length ? 'Multiple branches' : 'Unassigned branch', BranchScope: ids.length ? 'multiple' : 'unassigned' };
}
function fixtureBills(branchId, outstandingOnly) {
  return bookings.map(booking => {
    const paid = booking.payments.reduce((sum, amount) => sum + cents(amount), 0n);
    return {
      BookingID: booking.id, BillID: booking.id + 100, GuestName: `Guest ${booking.id}`,
      BookingStatus: booking.status, BillStatus: booking.billStatus,
      GeneratedDateDisplay: '2026-10-03 13:00:00', ...branchScope(booking),
      RoomCharges: booking.room, ServiceCharges: booking.services,
      TotalAmount: booking.total, PaidAmount: money(paid), OutstandingBalance: money(cents(booking.total) - paid),
    };
  }).filter(row => (!branchId || row.BranchID === branchId) && (!outstandingOnly || cents(row.OutstandingBalance) > 0n))
    .sort((left, right) => right.BookingID - left.BookingID);
}
function fixtureRevenue(branchId) {
  const buckets = new Map();
  for (const bill of fixtureBills(branchId, false).filter(row => row.BookingStatus === 'Checked-Out')) {
    const key = `${bill.BranchScope}:${bill.BranchID}`;
    const bucket = buckets.get(key) || {
      BranchID: bill.BranchID, BranchName: bill.BranchName, BranchScope: bill.BranchScope,
      Month: '2026-10', BillCount: 0, room: 0n, services: 0n, total: 0n,
    };
    bucket.BillCount += 1;
    bucket.room += cents(bill.RoomCharges);
    bucket.services += cents(bill.ServiceCharges);
    bucket.total += cents(bill.TotalAmount);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map(({ room, services, total, ...row }) => ({
    ...row, RoomRevenue: money(room), ServiceRevenue: money(services), TotalRevenue: money(total),
  })).sort((left, right) => left.BranchName.localeCompare(right.BranchName));
}
function fixtureServices(branchId, top, limit) {
  const groups = new Map();
  for (const entry of usage) {
    const booking = bookings.find(item => item.id === entry.booking);
    if (branchId && branchScope(booking).BranchID !== branchId) continue;
    const service = catalogue.find(item => item.id === entry.service);
    const row = groups.get(service.id) || { ServiceID: service.id, ServiceName: service.name, TimesUsed: 0, TotalQuantity: 0, amount: 0n };
    row.TimesUsed += 1;
    row.TotalQuantity += entry.quantity;
    row.amount += BigInt(entry.quantity) * cents(entry.savedPrice);
    groups.set(service.id, row);
  }
  const result = [...groups.values()].sort((left, right) => top
    ? right.TimesUsed - left.TimesUsed || right.TotalQuantity - left.TotalQuantity || left.ServiceID - right.ServiceID
    : Number(right.amount - left.amount) || left.ServiceID - right.ServiceID)
    .map(({ amount, ...row }) => ({ ...row, TotalRevenue: money(amount) }));
  return top ? result.slice(0, limit) : result;
}
const pool = {
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (databaseError) throw databaseError;
    if (overrideRows !== undefined) return [overrideRows];
    const branchId = /(?:WHERE br\.BranchID|scope\.BranchID) = \?/.test(sql) ? params[0] : undefined;
    if (sql.includes('AS Occupied')) return [branches.filter(branch => !branchId || branch.id === branchId).map(branch => {
      const localRooms = rooms.filter(room => room.branch === branch.id);
      return { BranchID: branch.id, BranchName: branch.name,
        Occupied: localRooms.filter(room => room.status === 'Occupied').length,
        Available: localRooms.filter(room => room.status === 'Available').length,
        Maintenance: localRooms.filter(room => room.status === 'Maintenance').length, TotalRooms: localRooms.length };
    })];
    if (sql.includes('AS OutstandingBalance')) return [fixtureBills(branchId, sql.includes('PaidAmount, 0.00) > 0'))];
    if (sql.includes('AS RoomRevenue')) {
      const offset = branchId ? 1 : 0;
      const year = sql.includes('YEAR(bl.GeneratedDate) = ?') ? params[offset] : undefined;
      const month = sql.includes('MONTH(bl.GeneratedDate) = ?') ? params[offset + 1] : undefined;
      return [(year && year !== 2026) || (month && month !== 10) ? [] : fixtureRevenue(branchId)];
    }
    return [fixtureServices(branchId, sql.includes('LIMIT ?'), params.at(-1))];
  },
};
require.cache[require.resolve('../config/db')] = { exports: pool };
const controllers = require('../controllers/reportController');
const endpoints = {
  occupancy: controllers.occupancyReport, billing: controllers.billingSummary,
  services: controllers.serviceUsageBreakdown, revenue: controllers.monthlyRevenueByBranch,
  top: controllers.topServices,
};
function invoke(endpoint, query = {}, user = manager) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      set(name, value) { headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data, headers }); return this; },
    };
    endpoints[endpoint]({ query, user }, res, reject);
  });
}
function checkMapping(sql) {
  assert.match(sql, /COUNT\(DISTINCT mapped_room\.BranchID\) = 1[\s\S]*THEN MIN\(mapped_room\.BranchID\) ELSE NULL/);
  assert.match(sql, /THEN 'unassigned'[\s\S]*THEN 'single'[\s\S]*ELSE 'multiple'/);
  assert.match(sql, /FROM BOOKING mapped_booking\s+LEFT JOIN BOOKED_ROOMS mapped_stay[\s\S]*LEFT JOIN ROOM mapped_room/);
  assert.match(sql, /GROUP BY mapped_booking\.BookingID/);
  assert.equal((sql.match(/JOIN BOOKED_ROOMS/g) || []).length, 1, 'Room joins belong only inside the one-row booking map.');
  assert.doesNotMatch(sql, /SUM\(DISTINCT/); // equal-valued bills must each count
  assert.doesNotMatch(sql, /ROOM_TYPE|DailyRate|UnitPrice|IsActive|fn_calculate/);
}

async function checkHttpAuthorization() {
  // Only token verification is stubbed. Exercise the real Express router,
  // authenticate/requireRole middleware and controller guards together.
  const tokens = {
    manager, admin,
    guest: { type: 'guest', id: 1 },
    receptionist: { type: 'staff', id: 3, role: 'Receptionist' },
    service: { type: 'staff', id: 4, role: 'ServiceStaff' },
    malformed: { ...manager, id: '2' },
  };
  require.cache[require.resolve('../config/auth')] = {
    exports: { verifyAccessToken(token) {
      if (!Object.hasOwn(tokens, token)) throw new Error('Invalid test token');
      return tokens[token];
    } },
  };
  const express = require('express');
  const app = express();
  app.use('/api/reports', require('../routes/reportRoutes'));
  app.use((error, req, res, next) => {
    void error; void req; void next;
    res.status(500).json({ error: 'Unable to load reports.' });
  });
  const http = require('node:http');
  function requestReport(route, token) {
    // Real HTTP request/response objects dispatched through Express without a
    // listening socket, so this also runs in restricted/offline environments.
    return new Promise((resolve, reject) => {
      const req = new http.IncomingMessage(null);
      req.method = 'GET';
      req.url = `/api/reports/${route}`;
      req.headers = token ? { authorization: `Bearer ${token}` } : {};
      const res = new http.ServerResponse(req);
      res.end = function end(chunk) {
        try {
          resolve({ status: this.statusCode, headers: this.getHeaders(), body: JSON.parse(String(chunk)) });
        } catch (error) { reject(error); }
        return this;
      };
      app.handle(req, res, reject);
    });
  }
  for (const route of ['occupancy', 'billing-summary', 'service-usage', 'revenue', 'top-services']) {
    for (const [token, expected] of [[null, 401], ['invalid', 401], ['guest', 403], ['receptionist', 403], ['service', 403], ['malformed', 403], ['manager', 200], ['admin', 200]]) {
      const before = queries.length;
      const response = await requestReport(route, token);
      const body = response.body;
      assert.equal(response.status, expected, `${route}: ${token || 'no token'}`);
      if (expected === 200) {
        assert.ok(Array.isArray(body));
        assert.equal(response.headers['cache-control'], 'no-store');
      } else assert.equal(queries.length, before, 'Unauthorized HTTP requests must not query the database.');
    }
    for (const query of ['branchId=1&branchId=2', 'branchId[evil]=1', 'unknown=1']) {
      const before = queries.length;
      const response = await requestReport(`${route}?${query}`, 'manager');
      assert.equal(response.status, 400);
      assert.equal(queries.length, before, 'Malformed HTTP query filters must not reach SQL.');
    }
  }
  databaseError = new Error('Private database failure');
  const response = await requestReport('revenue', 'manager');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Unable to load reports.' });
  databaseError = undefined;
}

(async () => {
  for (const user of [null, {}, { ...manager, type: 'guest' }, { ...manager, role: 'Receptionist' },
    { ...manager, role: 'ServiceStaff' }, { ...manager, role: 'manager' },
    ...['2', 0, -1, 1.5, 2147483648, Infinity, NaN, {}, null].map(id => ({ ...manager, id }))]) {
    assert.equal(canReadReports(user), false);
    for (const endpoint of Object.keys(endpoints)) assert.equal((await invoke(endpoint, {}, user)).status, 403);
  }
  for (const endpoint of Object.keys(endpoints)) {
    for (const raw of ['', '0', '-1', '01', '1.0', '1e2', ' 1', '2147483648', '1 OR 1=1', true, 1, ['1', '2'], {}, null, undefined]) {
      assert.equal((await invoke(endpoint, { branchId: raw })).status, 400);
    }
    for (const query of [null, [], 'branchId=1', new Date(), { unknown: '1' }, { 'branchId[]': '1' }, { [Symbol('filter')]: '1' }]) {
      assert.equal((await invoke(endpoint, query)).status, 400);
    }
  }
  for (const raw of ['0', '51', '-2', '05', '5.0', '5e0', '5; DROP TABLE BILL', 5, ['5'], {}, null]) {
    assert.equal((await invoke('top', { limit: raw })).status, 400);
  }
  for (const raw of ['999', '10000', '02026', '2026.0', '2026-10', ['2026'], 2026]) {
    assert.equal((await invoke('revenue', { year: raw })).status, 400);
  }
  for (const raw of ['0', '13', '01', '1.0', '-1', ['1'], 1]) {
    assert.equal((await invoke('revenue', { year: '2026', month: raw })).status, 400);
  }
  assert.equal((await invoke('revenue', { month: '10' })).status, 400);
  for (const raw of ['TRUE', '1', '', true, false, ['true'], {}]) {
    assert.equal((await invoke('billing', { outstandingOnly: raw })).status, 400);
  }
  for (const [endpoint, query] of [['occupancy', { year: '2026' }], ['billing', { limit: '5' }], ['services', { month: '10' }], ['revenue', { limit: '5' }], ['top', { year: '2026' }]]) {
    assert.equal((await invoke(endpoint, query)).status, 400);
  }
  assert.equal(queries.length, 0, 'Invalid identity/filter requests must stop before SQL.');
  assert.deepEqual(validateReportQuery('top', {}).value, { limit: 5 });
  assert.ok(validateReportQuery('invalid', {}).error);
  assert.deepEqual(validateReportQuery('revenue', { branchId: '2147483647', year: '1000', month: '12' }).value, { branchId: 2147483647, year: 1000, month: 12 });
  assert.equal(validateReportQuery('revenue', { year: '9999' }).value.year, 9999);

  for (const endpoint of Object.keys(endpoints)) {
    const result = await invoke(endpoint, {}, admin);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.headers['Cache-Control'], 'no-store');
    const statement = queries.at(-1);
    assert.equal((statement.sql.match(/\?/g) || []).length, statement.params.length);
    assert.doesNotMatch(statement.sql, /\b(?:INSERT|UPDATE|DELETE|CALL|DROP|CREATE)\b/);
    if (endpoint !== 'occupancy') checkMapping(statement.sql);
    if (endpoint !== 'top') assert.doesNotMatch(statement.sql, /\bLIMIT\b/);
  }
  const occupancy = (await invoke('occupancy')).data;
  assert.deepEqual(occupancy.find(row => row.BranchID === 3), { BranchID: 3, BranchName: 'Empty branch', Occupied: 0, Available: 0, Maintenance: 0, TotalRooms: 0 });
  assert.match(queries.at(-1).sql, /FROM BRANCH br LEFT JOIN ROOM r/);
  assert.match(queries.at(-1).sql, /COUNT\(r\.RoomID\) AS TotalRooms/);
  assert.equal((await invoke('occupancy', { branchId: '2147483647' })).data.length, 0);
  assert.deepEqual(queries.at(-1).params, [2147483647]);
  assert.doesNotMatch(queries.at(-1).sql, /2147483647/);

  const bills = (await invoke('billing')).data;
  assert.equal(bills.length, 6);
  assert.equal(new Set(bills.map(row => row.BillID)).size, 6);
  assert.equal(bills.find(row => row.BookingID === 13).OutstandingBalance, '-1.00');
  assert.equal(bills.find(row => row.BookingID === 10).PaidAmount, '110.00');
  assert.match(queries.at(-1).sql, /SELECT BookingID, SUM\(Amount\) AS PaidAmount FROM PAYMENT GROUP BY BookingID/);
  for (const field of ['RoomCharges', 'ServiceCharges', 'TotalAmount']) {
    assert.match(queries.at(-1).sql, new RegExp(`CAST\\(bl\\.${field} AS CHAR\\) AS ${field}`));
  }
  assert.match(queries.at(-1).sql, /CAST\(bl.TotalAmount - COALESCE\(paid.PaidAmount, 0\.00\) AS CHAR\)/);
  assert.deepEqual((await invoke('billing', { branchId: '1', outstandingOnly: 'true' })).data.map(row => row.BookingID), [11], 'Outstanding comes from actual balance even if saved status says Paid.');
  assert.deepEqual(queries.at(-1).params, [1]);
  assert.match(queries.at(-1).sql, /bl.TotalAmount - COALESCE\(paid.PaidAmount, 0\.00\) > 0/);
  assert.equal((await invoke('billing', { outstandingOnly: 'false' })).data.length, 6);

  const revenue = (await invoke('revenue')).data;
  assert.equal(revenue.find(row => row.BranchID === 1).BillCount, 2);
  assert.equal(revenue.find(row => row.BranchID === 1).TotalRevenue, '220.00', 'Two equal-valued bills count once each, including a two-room bill.');
  assert.equal(revenue.find(row => row.BranchScope === 'multiple').TotalRevenue, '240.00');
  assert.equal(revenue.find(row => row.BranchScope === 'unassigned').TotalRevenue, '300.00');
  assert.equal(revenue.find(row => row.BranchID === 2).TotalRevenue, '0.30');
  assert.equal(money(revenue.reduce((sum, row) => sum + cents(row.TotalRevenue), 0n)), '760.30');
  const revenueSql = queries.at(-1).sql;
  assert.match(revenueSql, /bk.BookingStatus = 'Checked-Out'/);
  assert.match(revenueSql, /DATE_FORMAT\(bl.GeneratedDate, '%Y-%m'\)/);
  assert.match(revenueSql, /CAST\(SUM\(bl.TotalAmount\) AS CHAR\)/);
  assert.match(revenueSql, /GROUP BY scope.BranchID, scope.BranchScope, br.Name/);
  assert.equal((await invoke('revenue', { branchId: '1', year: '2026', month: '10' })).data.length, 1);
  assert.deepEqual(queries.at(-1).params, [1, 2026, 10]);
  assert.match(queries.at(-1).sql, /YEAR\(bl.GeneratedDate\) = \?.*AND MONTH\(bl.GeneratedDate\) = \?/);
  assert.doesNotMatch(queries.at(-1).sql, /2026/);
  assert.deepEqual((await invoke('revenue', { year: '9999', month: '12' })).data, []);

  const services = (await invoke('services')).data;
  assert.equal(services.find(row => row.ServiceID === 1).TotalRevenue, '6.60', 'Saved historical price and retired services remain included.');
  assert.equal(services.find(row => row.ServiceID === 1).TotalQuantity, 6);
  assert.equal(services.find(row => row.ServiceID === 1).TimesUsed, 3);
  assert.match(queries.at(-1).sql, /CAST\(SUM\(su.Quantity \* su.PriceAtUsage\) AS CHAR\)/);
  assert.match(queries.at(-1).sql, /ORDER BY SUM\(su.Quantity \* su.PriceAtUsage\) DESC/);
  assert.equal((await invoke('services', { branchId: '1' })).data[0].TotalRevenue, '3.30');
  assert.deepEqual(queries.at(-1).params, [1]);
  assert.deepEqual((await invoke('top')).data.map(row => row.ServiceID), [1, 2, 3]);
  assert.deepEqual(queries.at(-1).params, [5]);
  assert.match(queries.at(-1).sql, /ORDER BY TimesUsed DESC, TotalQuantity DESC, sc.ServiceID ASC LIMIT \?/);
  assert.equal((await invoke('top', { branchId: '1', limit: '1' })).data.length, 1);
  assert.deepEqual(queries.at(-1).params, [1, 1]);
  await invoke('top', { limit: '50' });
  assert.deepEqual(queries.at(-1).params, [50]);

  overrideRows = [{ ServiceID: 1, ServiceName: 'Large exact sum', TimesUsed: '2', TotalQuantity: '3', TotalRevenue: '9999999999999999.99' }];
  assert.deepEqual((await invoke('top')).data[0], { ...overrideRows[0], TimesUsed: 2, TotalQuantity: 3 }, 'Counts normalize safely while money remains an exact string.');
  for (const invalid of [NaN, Infinity, -1, 1.5, '2.0', '9007199254740992', Number.MAX_SAFE_INTEGER + 1, null]) {
    overrideRows = [{ TimesUsed: 1, TotalQuantity: invalid }];
    await assert.rejects(invoke('services'), /supported numeric range/);
  }
  overrideRows = [];
  for (const endpoint of Object.keys(endpoints)) assert.deepEqual((await invoke(endpoint)).data, []);
  overrideRows = undefined;
  databaseError = new Error('database unavailable');
  for (const endpoint of Object.keys(endpoints)) await assert.rejects(invoke(endpoint), /database unavailable/);
  databaseError = undefined;
  await checkHttpAuthorization();
  console.log('PASS: real Express route authorization; manager/admin identities; strict report filters before SQL; parameterized read-only queries; zero-room branches; one-bill/one-booking branch mapping; exact saved amounts and payments; historical service prices; deterministic rankings; safe counts and error forwarding (mock tokens/database and independent fixtures, no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
