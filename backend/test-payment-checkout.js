// Verify the existing booking #4 scenario after each action in the staff page.
// Default: reads only, apart from creating/revoking this script's login session.
// Explicit --check-unpaid-guard attempts checkout only in unpaid/partial phases.
// Never creates services/payments, resets data, or checks out a settled stay.
const assert = require('node:assert/strict');

const phases = {
  unpaid: { status: 'Unpaid', paid: 0, balance: 15100, payments: [],
    instruction: 'Before payment: no payments, Unpaid bill, LKR 15100.00 outstanding, Checked-In / Occupied.' },
  partial: { status: 'Partially Paid', paid: 5000, balance: 10100, payments: [5000],
    instruction: 'After one LKR 5000.00 Cash payment: Partially Paid, LKR 10100.00 outstanding, Checked-In / Occupied.' },
  paid: { status: 'Paid', paid: 15100, balance: 0, payments: [5000, 10100],
    instruction: 'After the remaining LKR 10100.00 Cash payment: two payments, Paid, zero outstanding, still Checked-In / Occupied.' },
  complete: { status: 'Paid', paid: 15100, balance: 0, payments: [5000, 10100],
    instruction: 'After checkout through the staff page: two payments and both services retained, Paid, Checked-Out / Available, bill finalized by this staff account.' },
};
const usage = `Usage: node test-payment-checkout.js unpaid|partial|paid|complete [--check-unpaid-guard]
Set TEST_STAFF_USERNAME, TEST_STAFF_PASSWORD and TEST_STAFF_BOOKING_ID (existing scenario: 4).
TEST_API_URL defaults to http://localhost:5000/api; only loopback URLs are allowed.
${Object.entries(phases).map(([name, phase]) => `${name}: ${phase.instruction}`).join('\n')}
Every phase expects LKR 12000.00 room charges and two saved services:
Laundry quantity 2 at LKR 800.00, Room Service quantity 1 at LKR 1500.00; total LKR 15100.00.
By default this script only reads and cleans up its login session.
--check-unpaid-guard is allowed only with unpaid/partial; it attempts checkout, expects 409,
then rereads booking, bill, payments and service history to verify that nothing changed.
It never records a payment, resets data, or checks out a paid stay.`;

function configuration() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  assert.ok(args.length >= 1 && args.length <= 2 && Object.hasOwn(phases, args[0])
    && (args.length === 1 || args[1] === '--check-unpaid-guard'), usage);
  const phase = args[0];
  const checkGuard = args[1] === '--check-unpaid-guard';
  assert.ok(!checkGuard || ['unpaid', 'partial'].includes(phase),
    '--check-unpaid-guard is only permitted for unpaid or partial; paid/complete are read-only.');
  const api = new URL(process.env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(api.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash,
  'TEST_API_URL must be a local http(s) API URL without credentials, a query or a fragment.');
  const username = process.env.TEST_STAFF_USERNAME;
  const password = process.env.TEST_STAFF_PASSWORD;
  assert.ok(username && password, 'Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD.');
  const rawId = process.env.TEST_STAFF_BOOKING_ID;
  assert.ok(typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) && Number(rawId) <= 2147483647,
    'Set TEST_STAFF_BOOKING_ID to the existing booking reference (4 for the guided scenario; digits only).');
  return { api: api.toString().replace(/\/$/, ''), username, password, bookingId: Number(rawId), phase, checkGuard };
}

async function request(api, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error', // Do not send test credentials or tokens to a redirect target.
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function cents(value, message) {
  assert.ok(['number', 'string'].includes(typeof value), message);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  assert.ok(match, message);
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}
function money(actual, expected, message) {
  assert.equal(cents(actual, message), BigInt(expected) * 100n, message);
}
function positiveId(value, message) {
  assert.ok(Number.isSafeInteger(value) && value > 0, message);
}

async function readScenario(config, token) {
  const { api, bookingId } = config;
  const detail = await request(api, `/bookings/${bookingId}`, { token });
  assert.equal(detail.status, 200, 'Booking details could not be loaded.');
  const bill = await request(api, `/bookings/${bookingId}/bill`, { token });
  assert.equal(bill.status, 200, 'The bill could not be loaded.');
  const history = await request(api, `/service-usage/${bookingId}`, { token });
  assert.equal(history.status, 200, 'Service history could not be loaded.');
  return { detail: detail.data, bill: bill.data, history: history.data };
}

function verifyScenario(config, staffId, snapshot) {
  const { phase, bookingId } = config;
  const expected = phases[phase];
  const { detail, bill: data, history } = snapshot;
  const bookingStatus = phase === 'complete' ? 'Checked-Out' : 'Checked-In';
  const roomStatus = phase === 'complete' ? 'Available' : 'Occupied';
  assert.equal(detail.BookingID, bookingId);
  assert.equal(detail.BookingStatus, bookingStatus, expected.instruction);
  assert.ok(Array.isArray(detail.rooms) && detail.rooms.length, 'The stay must retain its reserved rooms.');
  for (const room of detail.rooms) assert.equal(room.RoomStatus, roomStatus);
  assert.equal(data.bookingId, bookingId);
  assert.equal(data.bookingStatus, bookingStatus, 'Bill and booking status must agree.');
  positiveId(data.bill?.BillID, 'The stay must have a saved bill.');
  assert.equal(data.bill.BookingID, bookingId);
  assert.equal(data.bill.BillStatus, expected.status);
  if (phase === 'complete') {
    assert.equal(data.bill.StaffID, staffId, 'Finalized bill StaffID must match the logged-in checkout staff account.');
  } else {
    assert.equal(data.bill.StaffID, null, 'The bill must not be finalized before checkout.');
  }
  for (const [field, stored, amount] of [
    ['roomCharges', 'RoomCharges', 12000], ['serviceCharges', 'ServiceCharges', 3100], ['totalAmount', 'TotalAmount', 15100],
  ]) {
    money(data[field], amount, `${field} differs from the saved scenario.`);
    money(data.bill[stored], amount, `Stored ${stored} differs from the saved scenario.`);
  }
  money(data.paidAmount, expected.paid, 'Paid amount is incorrect.');
  money(data.outstandingBalance, expected.balance, 'Outstanding balance is incorrect.');
  assert.ok(Array.isArray(data.payments), 'Payment history is missing.');
  assert.equal(data.payments.length, expected.payments.length, 'Unexpected payment count; inspect history before recording anything else.');
  const paymentIds = new Set();
  let totalPaid = 0n;
  for (const [index, amount] of expected.payments.entries()) {
    const payment = data.payments[index];
    positiveId(payment.PaymentID, 'Each saved payment needs a reference.');
    paymentIds.add(payment.PaymentID);
    assert.equal(payment.BookingID, bookingId);
    assert.equal(payment.BillID, data.bill.BillID);
    assert.equal(payment.PaymentMethod, 'Cash');
    assert.equal(payment.PaymentType, index === 0 ? 'Partial' : 'Full');
    money(payment.Amount, amount, `Payment ${index + 1} amount is incorrect.`);
    totalPaid += cents(payment.Amount, 'Invalid saved payment amount.');
    assert.match(payment.PaymentDateDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'Payment time must retain the hotel database date/time format.');
  }
  assert.equal(paymentIds.size, expected.payments.length, 'Payment references must be unique.');
  assert.equal(totalPaid, BigInt(expected.paid) * 100n, 'Saved payment sum is incorrect.');

  assert.ok(Array.isArray(data.serviceUsage), 'Saved service history is missing.');
  assert.equal(data.serviceUsage.length, 2, 'Expect exactly two saved services; do not add them again.');
  const serviceIds = new Set();
  for (const expectedService of [
    { name: 'Laundry', quantity: 2, price: 800, total: 1600 },
    { name: 'Room Service', quantity: 1, price: 1500, total: 1500 },
  ]) {
    const matches = data.serviceUsage.filter(row => row.ServiceName === expectedService.name);
    assert.equal(matches.length, 1, `Expect one saved ${expectedService.name} entry.`);
    const row = matches[0];
    positiveId(row.UsageID, 'Each saved service needs a reference.');
    serviceIds.add(row.UsageID);
    assert.equal(row.BookingID, bookingId);
    assert.equal(row.Quantity, expectedService.quantity);
    money(row.PriceAtUsage, expectedService.price, `${expectedService.name} saved price changed.`);
    money(row.LineTotal, expectedService.total, `${expectedService.name} line total changed.`);
    assert.match(row.UsageDateDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  }
  assert.equal(serviceIds.size, 2, 'Saved service references must be unique.');
  assert.ok(Array.isArray(history), 'Service-history response must be an array.');
  assert.deepEqual(history, data.serviceUsage, 'Bill and service-history endpoints must retain the same saved service rows.');
}

async function run() {
  const config = configuration();
  if (!config) { console.log(usage); return; }
  console.log(`Checking ${config.phase} for booking #${config.bookingId}: ${phases[config.phase].instruction}`);
  let refreshToken;
  try {
    const login = await request(config.api, '/auth/staff/login', {
      method: 'POST', body: { username: config.username, password: config.password },
    });
    assert.equal(login.status, 200, 'Staff login failed.');
    refreshToken = login.data.refreshToken;
    const token = login.data.token || login.data.accessToken;
    assert.ok(token && refreshToken, 'Access or refresh token missing.');
    assert.ok(['Receptionist', 'Manager', 'Admin'].includes(login.data.staff?.role), 'Use the front-desk staff test account.');
    assert.equal(login.data.staff.username, config.username, 'Login returned a different staff account.');
    const staffId = login.data.staff.staffId;
    positiveId(staffId, 'Login staffId is missing.');
    const before = await readScenario(config, token);
    verifyScenario(config, staffId, before);
    if (config.checkGuard) {
      console.log('Explicit guard check: attempt checkout once, expect 409, then verify the saved state is unchanged.');
      const checkout = await request(config.api, `/bookings/${config.bookingId}/check-out`, { token, method: 'POST' });
      assert.equal(checkout.status, 409, 'Unpaid checkout must be rejected with 409. Inspect the booking before any further action.');
      assert.match(checkout.data.error, /outstanding|balance|paid/i, 'Expected an unpaid-balance conflict.');
      const after = await readScenario(config, token);
      verifyScenario(config, staffId, after);
      assert.deepEqual(after, before, 'The rejected checkout must leave booking, rooms, bill, payments and service history unchanged.');
      console.log('PASS: unpaid checkout guard rejected the attempt and every reread matched the prior state.');
    }
    console.log(`PASS: ${config.phase}; bill #${before.bill.bill.BillID}, two saved services, ${before.bill.payments.length} payment(s), LKR ${phases[config.phase].paid.toFixed(2)} paid, LKR ${phases[config.phase].balance.toFixed(2)} outstanding.`);
  } finally {
    if (refreshToken) {
      const logout = await request(config.api, '/auth/logout', { method: 'POST', body: { refreshToken } });
      assert.equal(logout.status, 200, 'Test session logout failed.');
    }
  }
}

run().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
