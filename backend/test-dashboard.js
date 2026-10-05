// Live API smoke check: hotel-data GETs only, plus this test's login/logout.
// No direct database connection; this checks contracts, not payment accuracy.
const assert = require('node:assert/strict');

const help = `Usage: node backend/test-dashboard.js
Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD to a Manager or Admin account.
TEST_API_URL defaults to http://localhost:5000/api; loopback URLs only.
Keep hotel data unchanged while this read-only smoke check runs.
Checks response formats, room totals, branch filtering and invalid filters.
Does not independently prove saved payment totals or actual event timestamps.
No booking, bill, service, payment or room rows are written; login/logout manages
only this test's authentication session.`;
const roomFields = ['totalRooms', 'occupiedRooms', 'availableRooms', 'maintenanceRooms'];
const countFields = [...roomFields, 'todayCheckIns', 'todayCompletedCheckIns',
  'todayCheckOuts', 'todayCompletedCheckOuts', 'todayPaymentsCount', 'activeBookings'];

function config() {
  assert.equal(process.argv.length, 2, help);
  const api = new URL(process.env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(api.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash,
  'Use a local TEST_API_URL without credentials, query or fragment.');
  const username = process.env.TEST_STAFF_USERNAME;
  const password = process.env.TEST_STAFF_PASSWORD;
  assert.ok(username && password, 'Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD to a Manager/Admin account.');
  return { api: api.toString().replace(/\/$/, ''), username, password };
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
function count(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, 'Dashboard counts must be nonnegative safe integers.');
  return value;
}
function rooms(row, percentageKey) {
  roomFields.forEach(field => count(row[field]));
  assert.equal(row.occupiedRooms + row.availableRooms + row.maintenanceRooms, row.totalRooms,
    'Room status counts must add to total rooms.');
  const expected = row.totalRooms ? Number((100 * row.occupiedRooms / row.totalRooms).toFixed(2)) : null;
  assert.equal(row[percentageKey], expected, 'Occupancy percentage differs from room counts.');
  if (expected !== null) assert.ok(row[percentageKey] >= 0 && row[percentageKey] <= 100);
}
function dashboard(data, branchId) {
  assert.match(data.date, /^\d{4}-\d{2}-\d{2}$/, 'Dashboard must include its database date.');
  assert.equal(data.branchId, branchId);
  const summary = data.summary;
  assert.ok(summary && typeof summary === 'object', 'Dashboard summary is missing.');
  countFields.forEach(field => count(summary[field]));
  assert.equal(typeof summary.todayRevenue, 'string', 'Revenue must preserve decimal precision as a string.');
  assert.match(summary.todayRevenue, /^\d+\.\d{2}$/, 'Revenue must have two decimal places.');
  assert.ok(summary.todayCompletedCheckIns <= summary.todayCheckIns);
  assert.ok(summary.todayCompletedCheckOuts <= summary.todayCheckOuts);
  rooms(summary, 'currentOccupancyPercentage');
}
function reportRooms(row) {
  return [row.TotalRooms, row.Occupied, row.Available, row.Maintenance].map(count);
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
    assert.ok(['Manager', 'Admin'].includes(login.data.staff?.role), 'Use a Manager/Admin account for the dashboard.');
    const get = async path => {
      const result = await request(c.api, path, token);
      assert.equal(result.status, 200, `GET ${path} failed.`);
      return result.data;
    };
    assert.equal((await request(c.api, '/dashboard/admin')).status, 401, 'Dashboard must require authentication.');
    const all = await get('/dashboard/admin');
    dashboard(all, 'all');
    assert.ok(Array.isArray(all.branchBreakdown), 'Chain dashboard must include a branch breakdown.');
    const seen = new Set();
    for (const branch of all.branchBreakdown) {
      assert.ok(Number.isInteger(branch.branchId) && branch.branchId > 0 && branch.branchId <= 2147483647);
      assert.ok(!seen.has(branch.branchId), 'Duplicate dashboard branch.');
      seen.add(branch.branchId);
      rooms(branch, 'occupancyPercentage');
    }
    for (const field of roomFields) {
      assert.equal(all.branchBreakdown.reduce((sum, row) => sum + row[field], 0), all.summary[field],
        'Branch room breakdown must reconcile with chain totals.');
    }
    const occupancy = await get('/reports/occupancy');
    assert.ok(Array.isArray(occupancy), 'Occupancy report must return an array.');
    assert.equal(occupancy.length, all.branchBreakdown.length);
    for (const branch of all.branchBreakdown) {
      const report = occupancy.find(row => row.BranchID === branch.branchId);
      assert.ok(report, 'Dashboard branch is missing from occupancy report.');
      assert.deepEqual(roomFields.map(field => branch[field]), reportRooms(report),
        'Occupancy report differs; keep hotel data unchanged while checking.');
    }
    assert.ok(all.branchBreakdown.length, 'Add branch data through the normal project workflow before this smoke check.');
    const branch = all.branchBreakdown[0];
    const selected = await get(`/dashboard/admin?branchId=${branch.branchId}`);
    dashboard(selected, branch.branchId);
    assert.equal(selected.date, all.date, 'Database day changed during the smoke check; rerun it.');
    assert.deepEqual(roomFields.map(field => selected.summary[field]), roomFields.map(field => branch[field]),
      'Filtered dashboard differs; keep hotel data unchanged while checking.');
    for (const query of ['branchId=0', 'branchId=01', 'branchId=-1', 'branchId=1abc', 'branchId=1.2',
      'branchId=2147483648', 'branchId=1&branchId=2', 'branchId=', 'unexpected=1']) {
      assert.equal((await request(c.api, `/dashboard/admin?${query}`, token)).status, 400,
        `Invalid dashboard filter was accepted: ${query}`);
    }
    assert.deepEqual(await get('/dashboard/admin'), all,
      'Dashboard changed during the smoke check; keep hotel data unchanged and rerun.');
  } finally {
    if (refreshToken) {
      const logout = await request(c.api, '/auth/logout', null, { refreshToken });
      assert.equal(logout.status, 200, 'Test session logout failed.');
    }
  }
  console.log('PASS: live dashboard smoke check; response formats, room totals, branch filtering, authentication and invalid filters.');
  console.log('No hotel rows were changed by this test. Payment accuracy and event history were not independently verified.');
}
run().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
