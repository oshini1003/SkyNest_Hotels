'use strict';
// Hotel endpoints are GET-only. Only this check's login/logout sessions change.
const assert = require('node:assert/strict');

const help = `Usage: node backend/test-guest-bill.js
Set TEST_GUEST_USERNAME/PASSWORD to the owner of TEST_GUEST_BOOKING_ID, and
TEST_OTHER_GUEST_USERNAME/PASSWORD to a different guest. Use an existing saved
bill with at least one service entry and payment. Keep the hotel history unchanged
while checking; do not make another payment or check out just to run this check.
TEST_API_URL defaults to http://localhost:5000/api (loopback URLs only).
Hotel endpoints are GET-only. The check opens and closes two guest login sessions.
No credentials, guest names or contact details are printed.`;

function configuration(env = process.env) {
  const api = new URL(env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(api.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash,
  'Use a local TEST_API_URL without credentials, query or fragment.');
  for (const key of ['TEST_GUEST_USERNAME', 'TEST_GUEST_PASSWORD', 'TEST_OTHER_GUEST_USERNAME', 'TEST_OTHER_GUEST_PASSWORD']) {
    assert.ok(typeof env[key] === 'string' && env[key].trim(), `Set ${key}.`);
  }
  assert.ok(typeof env.TEST_GUEST_BOOKING_ID === 'string'
    && /^[1-9]\d*$/.test(env.TEST_GUEST_BOOKING_ID)
    && Number(env.TEST_GUEST_BOOKING_ID) <= 2147483647,
  'Set TEST_GUEST_BOOKING_ID to a positive booking reference (digits only).');
  return {
    api: api.toString().replace(/\/$/, ''), bookingId: Number(env.TEST_GUEST_BOOKING_ID),
    guest: { username: env.TEST_GUEST_USERNAME, password: env.TEST_GUEST_PASSWORD },
    other: { username: env.TEST_OTHER_GUEST_USERNAME, password: env.TEST_OTHER_GUEST_PASSWORD },
  };
}

async function request(api, path, token, body) {
  assert.ok(body === undefined || ['/auth/guest/login', '/auth/logout'].includes(path),
    'Only test-session requests may write.');
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function validId(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
function cents(value) {
  assert.ok(['string', 'number'].includes(typeof value), 'A monetary value is missing.');
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
  assert.ok(match, 'A monetary value is not a nonnegative exact decimal.');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}

function checkBill(data, bookingId, bookingStatus) {
  assert.equal(data?.bookingId, bookingId, 'The bill belongs to another booking.');
  assert.equal(data.bookingStatus, bookingStatus, 'Booking and bill statuses differ; keep the fixture unchanged.');
  assert.ok(['Checked-In', 'Checked-Out'].includes(bookingStatus), 'Use an existing checked-in or completed stay.');
  const bill = data.bill;
  assert.ok(bill && validId(bill.BillID), 'Use a saved bill, not a pre-check-in estimate.');
  assert.equal(bill.BookingID, bookingId, 'The saved bill belongs to another booking.');
  assert.ok(Array.isArray(data.serviceUsage) && data.serviceUsage.length,
    'Use an existing bill with at least one saved service entry.');
  assert.ok(Array.isArray(data.payments) && data.payments.length,
    'Use an existing bill with at least one saved payment.');

  const room = cents(bill.RoomCharges);
  const services = cents(bill.ServiceCharges);
  const total = cents(bill.TotalAmount);
  assert.equal(total, room + services, 'Saved bill charges do not reconcile.');
  assert.equal(cents(data.roomCharges), room, 'Response room charges differ from the saved bill.');
  assert.equal(cents(data.serviceCharges), services, 'Response service charges differ from the saved bill.');
  assert.equal(cents(data.totalAmount), total, 'Response total differs from the saved bill.');

  const usageIds = new Set();
  let serviceSum = 0n;
  for (const row of data.serviceUsage) {
    assert.ok(validId(row.UsageID) && !usageIds.has(row.UsageID), 'A service reference is missing or duplicated.');
    usageIds.add(row.UsageID);
    assert.equal(row.BookingID, bookingId, 'A service belongs to another booking.');
    assert.ok(validId(row.ServiceID) && validId(row.Quantity), 'A service identity or quantity is invalid.');
    assert.ok(typeof row.ServiceName === 'string' && row.ServiceName.trim(), 'A saved service name is missing.');
    assert.match(row.UsageDateDisplay || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'A service database date/time is missing.');
    const line = cents(row.PriceAtUsage) * BigInt(row.Quantity);
    assert.equal(cents(row.LineTotal), line, 'A service line differs from its saved price and quantity.');
    serviceSum += line;
  }
  assert.equal(serviceSum, services, 'Saved service lines do not reconcile with bill charges.');

  const paymentIds = new Set();
  let paid = 0n;
  for (const row of data.payments) {
    assert.ok(validId(row.PaymentID) && !paymentIds.has(row.PaymentID), 'A payment reference is missing or duplicated.');
    paymentIds.add(row.PaymentID);
    assert.equal(row.BookingID, bookingId, 'A payment belongs to another booking.');
    assert.equal(row.BillID, bill.BillID, 'A payment belongs to another bill.');
    assert.ok(['Cash', 'Card', 'Bank Transfer'].includes(row.PaymentMethod), 'A saved payment method is invalid.');
    assert.ok(['Full', 'Partial'].includes(row.PaymentType), 'A saved payment classification is invalid.');
    assert.match(row.PaymentDateDisplay || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'A payment database date/time is missing.');
    const amount = cents(row.Amount);
    assert.ok(amount > 0n, 'A saved payment must be positive.');
    paid += amount;
  }
  assert.ok(paid <= total, 'Saved payments exceed the recorded bill total.');
  assert.equal(cents(data.paidAmount), paid, 'Paid amount differs from saved payments.');
  assert.equal(cents(data.outstandingBalance), total - paid, 'Outstanding balance does not reconcile.');
  assert.equal(bill.BillStatus, paid === total ? 'Paid' : 'Partially Paid', 'Saved payment status differs from the balance.');
  if (bookingStatus === 'Checked-Out') assert.equal(paid, total, 'A completed stay still has an outstanding balance.');
  return { billId: bill.BillID, services: usageIds.size, payments: paymentIds.size };
}

async function run(config, call = request) {
  const sessions = [];
  let problem;
  try {
    async function login(credentials) {
      const response = await call(config.api, '/auth/guest/login', null, credentials);
      assert.equal(response.status, 200, 'Guest test-account login failed.');
      const data = response.data;
      if (typeof data?.refreshToken === 'string' && data.refreshToken) sessions.push(data.refreshToken);
      assert.ok(typeof data?.token === 'string' && data.token
        && typeof data.refreshToken === 'string' && data.refreshToken, 'Guest login tokens are missing.');
      assert.ok(validId(data.guest?.guestId), 'Guest login identity is missing.');
      return data;
    }
    const owner = await login(config.guest);
    const other = await login(config.other);
    assert.notEqual(owner.guest.guestId, other.guest.guestId, 'Use two different guest accounts.');
    const get = async path => {
      const response = await call(config.api, path, owner.token);
      assert.equal(response.status, 200, 'The owner could not read the selected booking history.');
      return response.data;
    };
    const paths = [`/bookings/${config.bookingId}`, `/bookings/${config.bookingId}/bill`, `/service-usage/${config.bookingId}`];
    const before = new Map();
    for (const path of paths) before.set(path, await get(path));
    const detail = before.get(paths[0]);
    assert.equal(detail?.BookingID, config.bookingId, 'The booking detail has an unexpected reference.');
    assert.equal(detail.GuestID, owner.guest.guestId, 'The selected booking does not belong to the first guest.');
    const bill = before.get(paths[1]);
    const summary = checkBill(bill, config.bookingId, detail.BookingStatus);
    assert.deepEqual(before.get(paths[2]), bill.serviceUsage,
      'Bill and service endpoints disagree; keep the fixture unchanged while checking.');

    for (const path of paths) {
      assert.equal((await call(config.api, path)).status, 401, 'Booking history was available without authentication.');
      const foreign = await call(config.api, path, other.token);
      assert.equal(foreign.status, 404, 'Another guest could read the selected booking history.');
      assert.deepEqual(foreign.data, { error: 'Booking not found.' }, 'A foreign-booking error exposed extra details.');
    }
    for (const [path, prior] of before) {
      assert.deepEqual(await get(path), prior, 'Saved hotel history changed while checking; inspect before repeating.');
    }
    return { bookingId: config.bookingId, ...summary };
  } catch (error) { problem = error; throw error; }
  finally {
    let logoutProblem;
    for (const refreshToken of sessions.reverse()) {
      try {
        assert.equal((await call(config.api, '/auth/logout', null, { refreshToken })).status, 200,
          'Test-session logout failed.');
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
    console.log(`PASS: guest-owned booking #${result.bookingId}, bill #${result.billId}; ${result.services} saved service entry/entries and ${result.payments} payment(s) reconcile.`);
    console.log('Other-guest and anonymous access were rejected. Hotel requests were GET-only; reread history was unchanged and both test sessions were closed.');
    console.log('This API smoke check does not verify browser rendering, payment processing, concurrent writes or catalogue prices before services were saved.');
  })().catch(error => {
    // Do not print raw response payloads, credentials, tokens or assertion diffs.
    console.error('FAIL:', error?.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Local guest-bill verification did not complete.');
    process.exitCode = 1;
  });
}
module.exports = { configuration, run };
