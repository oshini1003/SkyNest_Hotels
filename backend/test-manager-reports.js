// Local live check: GET reports/booking/bill endpoints only, plus this test's
// login/logout session. Never creates bookings, services, payments or checkout.
const assert = require('node:assert/strict');

const endpoints = ['occupancy', 'billing-summary', 'service-usage', 'revenue', 'top-services'];
const help = `Usage: node backend/test-manager-reports.js
Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD to a Manager or Admin account.
Set TEST_STAFF_BOOKING_ID to the completed guided booking (4).
TEST_API_URL defaults to http://localhost:5000/api; loopback URLs only.
Uses the completed LKR 15100.00 scenario (12000 room + 3100 services,
15100 paid, two services and two payments). Other hotel data is allowed.
Checks report totals, filters and ranking against saved records.
Keep hotel data unchanged while this read-only check runs.
No booking, service, bill, payment or room rows are written.`;

function config() {
  assert.equal(process.argv.length, 2, help);
  const api = new URL(process.env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(api.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash,
  'Use a local TEST_API_URL without credentials, query or fragment.');
  const username = process.env.TEST_STAFF_USERNAME;
  const password = process.env.TEST_STAFF_PASSWORD;
  assert.ok(username && password, 'Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD to a Manager/Admin account.');
  const rawId = process.env.TEST_STAFF_BOOKING_ID;
  assert.ok(typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) && Number(rawId) <= 2147483647,
    'Set TEST_STAFF_BOOKING_ID to the completed booking reference (4).');
  return { api: api.toString().replace(/\/$/, ''), username, password, id: Number(rawId) };
}

async function request(api, path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store',
  });
  return { status: response.status, data: await response.json() };
}
function cents(value) {
  assert.ok(['number', 'string'].includes(typeof value), 'Missing money value.');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  assert.ok(m, 'Invalid money format.');
  const amount = BigInt(m[2]) * 100n + BigInt((m[3] || '').padEnd(2, '0'));
  return m[1] ? -amount : amount;
}
function number(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, 'Invalid report count.');
  return value;
}
function revenueKey(row) { return `${row.BranchScope}:${row.BranchID}:${row.Month}`; }
function expectedRevenue(bills) {
  const groups = new Map();
  for (const bill of bills.filter(row => row.BookingStatus === 'Checked-Out')) {
    const Month = bill.GeneratedDateDisplay.slice(0, 7);
    const key = revenueKey({ ...bill, Month });
    const row = groups.get(key) || { count: 0, room: 0n, service: 0n, total: 0n };
    row.count++;
    row.room += cents(bill.RoomCharges);
    row.service += cents(bill.ServiceCharges);
    row.total += cents(bill.TotalAmount);
    groups.set(key, row);
  }
  return groups;
}
function revenueValues(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = revenueKey(row);
    assert.ok(!groups.has(key), 'Duplicate monthly branch group.');
    const value = { count: number(row.BillCount), room: cents(row.RoomRevenue),
      service: cents(row.ServiceRevenue), total: cents(row.TotalRevenue) };
    assert.equal(value.room + value.service, value.total, 'Report charge components must add to total.');
    groups.set(key, value);
  }
  return groups;
}

async function run() {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) { console.log(help); return; }
  const c = config();
  let refreshToken;
  try {
    const login = await request(c.api, '/auth/staff/login', null, { username: c.username, password: c.password });
    assert.equal(login.status, 200, 'Staff login failed.');
    refreshToken = login.data.refreshToken;
    const token = login.data.token || login.data.accessToken;
    assert.ok(token && refreshToken, 'Login tokens are missing.');
    assert.ok(['Manager', 'Admin'].includes(login.data.staff?.role), 'Use nimal (Manager) or an Admin account for reports.');
    const get = async path => {
      const result = await request(c.api, path, token);
      assert.equal(result.status, 200, `GET ${path} failed.`);
      return result.data;
    };
    const before = await get(`/bookings/${c.id}/bill`);
    assert.equal(before.bookingStatus, 'Checked-Out', 'Use the already completed stay; do not check it out again.');
    assert.equal(before.bill?.BillStatus, 'Paid');
    assert.equal(cents(before.roomCharges), 1200000n);
    assert.equal(cents(before.serviceCharges), 310000n);
    assert.equal(cents(before.totalAmount), 1510000n);
    assert.equal(cents(before.paidAmount), 1510000n);
    assert.equal(cents(before.outstandingBalance), 0n);
    assert.equal(before.serviceUsage.length, 2);
    assert.equal(before.payments.length, 2);

    const reports = {};
    for (const name of endpoints) {
      const unauthorized = await request(c.api, `/reports/${name}`);
      assert.equal(unauthorized.status, 401, `${name} must require authentication.`);
      reports[name] = await get(`/reports/${name}${name === 'top-services' ? '?limit=50' : ''}`);
      assert.ok(Array.isArray(reports[name]), `${name} must return an array.`);
    }
    const bills = reports['billing-summary'];
    const bill = bills.find(row => row.BookingID === c.id);
    assert.ok(bill, 'Completed booking is missing from the billing report.');
    assert.equal(bill.BillID, before.bill.BillID);
    assert.equal(bill.BillStatus, 'Paid');
    assert.equal(bill.BookingStatus, 'Checked-Out');
    assert.equal(bill.BranchScope, 'single', 'Guided booking should belong to one branch.');
    assert.equal(cents(bill.TotalAmount), 1510000n);
    assert.equal(cents(bill.PaidAmount), 1510000n);
    assert.equal(cents(bill.OutstandingBalance), 0n);
    assert.equal(new Set(bills.map(row => row.BillID)).size, bills.length, 'Each bill must appear once.');
    for (const row of bills) {
      assert.equal(cents(row.TotalAmount), cents(row.RoomCharges) + cents(row.ServiceCharges));
      assert.equal(cents(row.OutstandingBalance), cents(row.TotalAmount) - cents(row.PaidAmount));
      assert.match(row.GeneratedDateDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    const outstanding = await get('/reports/billing-summary?outstandingOnly=true');
    assert.deepEqual(outstanding, bills.filter(row => cents(row.OutstandingBalance) > 0n),
      'Outstanding filter differs from saved balance; keep hotel data unchanged while checking.');
    const selectedBills = await get(`/reports/billing-summary?branchId=${bill.BranchID}`);
    assert.deepEqual(selectedBills, bills.filter(row => row.BranchID === bill.BranchID && row.BranchScope === 'single'));

    for (const row of reports.occupancy) {
      assert.equal(number(row.Occupied) + number(row.Available) + number(row.Maintenance), number(row.TotalRooms));
    }
    assert.deepEqual(await get(`/reports/occupancy?branchId=${bill.BranchID}`),
      reports.occupancy.filter(row => row.BranchID === bill.BranchID));
    assert.deepEqual(revenueValues(reports.revenue), expectedRevenue(bills),
      'Finalized report must count saved bills exactly once, grouped by bill-opened month.');
    const [year, month] = bill.GeneratedDateDisplay.slice(0, 7).split('-');
    const monthly = await get(`/reports/revenue?branchId=${bill.BranchID}&year=${year}&month=${Number(month)}`);
    assert.deepEqual(monthly, reports.revenue.filter(row => row.BranchScope === 'single'
      && row.BranchID === bill.BranchID && row.Month === `${year}-${month}`));

    const usage = reports['service-usage'];
    for (const saved of before.serviceUsage) {
      const aggregate = usage.find(row => row.ServiceID === saved.ServiceID);
      assert.ok(aggregate, 'Saved service is missing from the report.');
      assert.ok(number(aggregate.TimesUsed) >= 1 && number(aggregate.TotalQuantity) >= saved.Quantity);
      assert.ok(cents(aggregate.TotalRevenue) >= cents(saved.LineTotal));
    }
    const ranking = [...usage].sort((a, b) => b.TimesUsed - a.TimesUsed || b.TotalQuantity - a.TotalQuantity || a.ServiceID - b.ServiceID);
    const keys = row => [row.ServiceID, row.TimesUsed, row.TotalQuantity, cents(row.TotalRevenue).toString()];
    assert.deepEqual(reports['top-services'].map(keys), ranking.slice(0, 50).map(keys));
    assert.deepEqual((await get('/reports/top-services?limit=1')).map(keys), ranking.slice(0, 1).map(keys));
    const branchUsage = await get(`/reports/service-usage?branchId=${bill.BranchID}`);
    for (const saved of before.serviceUsage) {
      assert.ok(branchUsage.some(row => row.ServiceID === saved.ServiceID && row.TotalQuantity >= saved.Quantity),
        'Branch service filter lost a saved service.');
    }
    for (const path of ['/reports/occupancy?branchId=01', '/reports/billing-summary?outstandingOnly=yes',
      '/reports/service-usage?branchId=-1', '/reports/revenue?month=10', '/reports/revenue?year=2026x',
      '/reports/top-services?limit=0', '/reports/top-services?limit=51']) {
      assert.equal((await request(c.api, path, token)).status, 400, `Invalid filter was not rejected: ${path}`);
    }
    assert.deepEqual(await get(`/bookings/${c.id}/bill`), before,
      'Booking, bill, services or payments changed during the report check.');
    console.log(`PASS: five live reports, completed booking #${c.id} (LKR 15100.00 paid, zero outstanding), finalized totals counted once, branch/month/outstanding filters, service ranking and unchanged saved history.`);
    console.log('No booking, bill, service, payment or room rows were changed by this test.');
  } finally {
    if (refreshToken) {
      const logout = await request(c.api, '/auth/logout', null, { refreshToken });
      assert.equal(logout.status, 200, 'Test session logout failed.');
    }
  }
}
run().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
