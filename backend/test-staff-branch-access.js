'use strict';
// Live hotel-data reads only. The only writes are this test's login/logout sessions.
const assert = require('node:assert/strict');

const help = `Usage: node backend/test-staff-branch-access.js
Set TEST_STAFF_USERNAME/PASSWORD to a Receptionist or ServiceStaff account,
TEST_MANAGER_USERNAME/PASSWORD to a Manager/Admin account,
TEST_STAFF_OWN_BOOKING_ID and TEST_STAFF_OTHER_BOOKING_ID to existing references.
The first reservation must belong entirely to the staff member's branch; the
second must belong entirely to another branch. TEST_API_URL defaults to
http://localhost:5000/api (loopback URLs only). Keep hotel data unchanged while
checking. Hotel endpoints are GET-only; this test does not exercise write guards
or prove concurrent race handling. No credentials or guest details are printed.`;

function configuration(env = process.env) {
  const api = new URL(env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(api.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash,
  'Use a local TEST_API_URL without credentials, query or fragment.');
  for (const key of ['TEST_STAFF_USERNAME', 'TEST_STAFF_PASSWORD', 'TEST_MANAGER_USERNAME', 'TEST_MANAGER_PASSWORD']) {
    assert.ok(typeof env[key] === 'string' && env[key].trim(), `Set ${key}.`);
  }
  function id(key) {
    assert.match(env[key] || '', /^[1-9]\d*$/, `Set ${key} to a positive booking reference.`);
    const value = Number(env[key]);
    assert.ok(Number.isSafeInteger(value) && value <= 2147483647, `Invalid ${key}.`);
    return value;
  }
  const own = id('TEST_STAFF_OWN_BOOKING_ID');
  const other = id('TEST_STAFF_OTHER_BOOKING_ID');
  assert.notEqual(own, other, 'Use two different booking references.');
  return { api: api.toString().replace(/\/$/, ''), own, other,
    staff: { username: env.TEST_STAFF_USERNAME, password: env.TEST_STAFF_PASSWORD },
    manager: { username: env.TEST_MANAGER_USERNAME, password: env.TEST_MANAGER_PASSWORD } };
}

async function request(api, path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function id(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
function bookingRooms(booking, bookingId) {
  assert.equal(booking.BookingID, bookingId, 'Unexpected booking reference.');
  assert.ok(Array.isArray(booking.rooms) && booking.rooms.length, 'The fixture must have assigned rooms.');
  assert.ok(booking.rooms.every(room => id(room.BranchID)), 'Room branch is missing.');
  return booking.rooms;
}

async function run(config, call = request) {
  const sessions = [];
  let problem;
  try {
    async function login(credentials, roles) {
      const result = await call(config.api, '/auth/staff/login', null, credentials);
      assert.equal(result.status, 200, 'Test account login failed.');
      if (typeof result.data?.refreshToken === 'string') sessions.push(result.data.refreshToken);
      assert.ok(typeof result.data?.token === 'string' && typeof result.data.refreshToken === 'string', 'Login tokens are missing.');
      assert.ok(roles.includes(result.data.staff?.role), 'Use the requested test account role.');
      return result.data;
    }
    const staff = await login(config.staff, ['Receptionist', 'ServiceStaff']);
    const manager = await login(config.manager, ['Manager', 'Admin']);
    const get = async (path, token) => {
      const response = await call(config.api, path, token);
      assert.equal(response.status, 200, `GET ${path} failed.`);
      return response.data;
    };
    assert.equal((await call(config.api, '/staff/scope')).status, 401, 'Staff scope must require authentication.');
    const scope = await get('/staff/scope', staff.token);
    assert.equal(scope.staffId, staff.staff.staffId, 'Scope belongs to another staff member.');
    assert.equal(scope.role, staff.staff.role, 'Scope role differs from login.');
    assert.ok(id(scope.branchId) && typeof scope.branchName === 'string' && scope.branchName.trim(), 'Assigned branch is missing.');
    const managerScope = await get('/staff/scope', manager.token);
    assert.ok(['Manager', 'Admin'].includes(managerScope.role), 'Manager scope is missing.');

    const paths = bookingId => [`/bookings/${bookingId}`, `/bookings/${bookingId}/bill`, `/service-usage/${bookingId}`];
    const before = new Map();
    for (const bookingId of [config.own, config.other]) {
      for (const path of paths(bookingId)) before.set(path, await get(path, manager.token));
    }
    assert.ok(bookingRooms(before.get(`/bookings/${config.own}`), config.own)
      .every(room => room.BranchID === scope.branchId), 'The own-booking fixture is outside this staff branch.');
    const otherRooms = bookingRooms(before.get(`/bookings/${config.other}`), config.other);
    assert.ok(otherRooms.every(room => room.BranchID !== scope.branchId), 'The other-booking fixture must be in another branch.');

    for (const path of paths(config.own)) {
      assert.deepEqual(await get(path, staff.token), before.get(path), 'Own-branch response differs from the manager response.');
    }
    for (const path of paths(config.other)) {
      const response = await call(config.api, path, staff.token);
      assert.equal(response.status, 404, 'Another branch booking was exposed.');
      assert.deepEqual(response.data, { error: 'Booking not found.' }, 'Foreign-booking error must not expose details.');
    }
    const list = await get('/bookings', staff.token);
    assert.ok(Array.isArray(list), 'Booking list must be an array.');
    for (const row of list) {
      assert.ok(id(row.BookingID), 'Invalid booking reference in list.');
      assert.ok(bookingRooms(row, row.BookingID).every(room => room.BranchID === scope.branchId), 'Booking list leaked another branch.');
    }
    assert.deepEqual(await get(`/bookings?bookingId=${config.other}`, staff.token), [], 'A reference filter exposed another branch.');
    const filtered = await call(config.api, `/bookings?branchId=${otherRooms[0].BranchID}`, staff.token);
    assert.ok(filtered.status === 403 || (filtered.status === 200 && Array.isArray(filtered.data) && filtered.data.length === 0),
      'A branch filter expanded staff access.');
    for (const [path, prior] of before) {
      assert.deepEqual(await get(path, manager.token), prior, 'Saved hotel history changed while checking; inspect before repeating.');
    }
    return { staffId: scope.staffId, branchId: scope.branchId, own: config.own, other: config.other };
  } catch (error) { problem = error; throw error; }
  finally {
    let logoutProblem;
    for (const refreshToken of sessions.reverse()) {
      try {
        assert.equal((await call(config.api, '/auth/logout', null, { refreshToken })).status, 200, 'Test session logout failed.');
      } catch (error) { logoutProblem ||= error; }
    }
    if (!problem && logoutProblem) throw logoutProblem;
  }
}

if (require.main === module) {
  (async () => {
    if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) { console.log(help); return; }
    assert.equal(process.argv.length, 2, help);
    const result = await run(configuration());
    console.log(`PASS: staff #${result.staffId} branch #${result.branchId}; own booking #${result.own} visible, other booking #${result.other} hidden; manager access retained.`);
    console.log('GET-only hotel checks: list/filter/detail/bill/service access and unchanged saved history. Test login sessions were closed.');
    console.log('Live write guards and concurrent races were not exercised by this smoke check.');
  })().catch(error => {
    // Assertion messages are deliberately static: never print actual/expected payloads or tokens.
    console.error('FAIL:', error?.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Local API verification did not complete.');
    process.exitCode = 1;
  });
}
module.exports = { configuration, run };
