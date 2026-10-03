// Reads the seeded service scenario after you record it through the staff page.
// This script does not add services, take payments, cancel or check out a stay.
const assert = require('node:assert/strict');
const API = (process.env.TEST_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function money(actual, expected, message) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual)
    && Math.abs(actual - expected) < 0.005, message);
}

async function run() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname),
    'Use the local integration API for this check.');
  const username = process.env.TEST_STAFF_USERNAME;
  const password = process.env.TEST_STAFF_PASSWORD;
  const rawId = process.env.TEST_STAFF_BOOKING_ID;
  assert.ok(username && password, 'Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD.');
  assert.ok(typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) && Number(rawId) <= 2147483647,
    'Set TEST_STAFF_BOOKING_ID to the tested booking reference (digits only).');
  const bookingId = Number(rawId);
  let refreshToken;
  try {
    const login = await request('/auth/staff/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, 'Staff login failed.');
    refreshToken = login.data.refreshToken;
    const token = login.data.token || login.data.accessToken;
    assert.ok(token, 'Access token missing.');
    assert.ok(['Admin', 'Manager', 'Receptionist', 'ServiceStaff'].includes(login.data.staff?.role),
      'Use a hotel staff test account.');

    const detail = await request(`/bookings/${bookingId}`, { token });
    assert.equal(detail.status, 200, 'Booking details could not be loaded.');
    assert.equal(detail.data.BookingStatus, 'Checked-In', 'Keep the test stay checked in.');
    assert.ok(detail.data.rooms?.length, 'The stay needs a reserved room.');
    for (const room of detail.data.rooms) assert.equal(room.RoomStatus, 'Occupied');

    const response = await request(`/bookings/${bookingId}/bill`, { token });
    assert.equal(response.status, 200, 'The bill could not be loaded.');
    const data = response.data;
    assert.equal(data.bookingId, bookingId);
    assert.ok(data.bill?.BillID > 0, 'The checked-in stay must have an open bill.');
    assert.equal(data.bill.BookingID, bookingId);
    assert.equal(data.bill.BillStatus, 'Unpaid');
    assert.deepEqual(data.payments, [], 'This scenario expects no payments yet.');
    assert.ok(Array.isArray(data.serviceUsage), 'Service history is missing.');
    assert.equal(data.serviceUsage.length, 2,
      'Expect exactly two entries: Laundry quantity 2, and Room Service quantity 1. Inspect history before adding anything else.');
    const expected = [
      { name: 'Laundry', quantity: 2, price: 800, total: 1600 },
      { name: 'Room Service', quantity: 1, price: 1500, total: 1500 },
    ];
    const ids = new Set();
    for (const item of expected) {
      const matches = data.serviceUsage.filter(row => row.ServiceName === item.name);
      assert.equal(matches.length, 1, `Expect one saved ${item.name} entry.`);
      const row = matches[0];
      assert.ok(Number.isSafeInteger(row.UsageID) && row.UsageID > 0, 'Saved usage reference is missing.');
      ids.add(row.UsageID);
      assert.equal(row.BookingID, bookingId);
      assert.equal(row.Quantity, item.quantity, `${item.name} quantity is incorrect.`);
      money(row.PriceAtUsage, item.price, `${item.name} must retain its seeded price when saved.`);
      money(row.LineTotal, item.total, `${item.name} line total is incorrect.`);
      assert.match(row.UsageDateDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        'Usage time must be supplied as a hotel database date/time string.');
    }
    assert.equal(ids.size, 2, 'Each saved entry must have its own reference.');
    money(data.roomCharges, 12000, 'This scenario uses the one-night Colombo Double stay.');
    money(data.serviceCharges, 3100, 'Service charges must be 1600 + 1500.');
    money(data.totalAmount, 15100, 'Total must include room charges and both services.');
    money(data.outstandingBalance, 15100, 'The full bill must remain outstanding.');
    money(data.bill.RoomCharges, 12000, 'Stored room charges differ.');
    money(data.bill.ServiceCharges, 3100, 'Stored service charges were not updated.');
    money(data.bill.TotalAmount, 15100, 'Stored bill total was not updated.');

    const history = await request(`/service-usage/${bookingId}`, { token });
    assert.equal(history.status, 200, 'Service history could not be read.');
    assert.ok(Array.isArray(history.data));
    assert.equal(history.data.length, 2);
    assert.deepEqual(history.data.map(row => row.UsageID).sort((a, b) => a - b), [...ids].sort((a, b) => a - b),
      'Bill and service-history endpoints must include the same saved entries.');

    console.log(`PASS: booking #${bookingId} has 2 saved service entries, LKR 3100.00 service charges, LKR 15100.00 total/outstanding, an Unpaid bill and no payments.`);
    console.log('The room remains Occupied and the stay remains Checked-In for the payment and checkout stage.');
  } finally {
    if (refreshToken) {
      await request('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
    }
  }
}

run().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
