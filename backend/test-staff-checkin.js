// Verifies a stay that you have already checked in through the staff website.
// Reads reservation/room/bill data; does not book, cancel, pay or check out.
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

function closeTo(actual, expected, message) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 0.005, message);
}

async function run() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname),
    'Use the local integration API for this check.');
  const username = process.env.TEST_STAFF_USERNAME;
  const password = process.env.TEST_STAFF_PASSWORD;
  const rawId = process.env.TEST_STAFF_BOOKING_ID;
  assert.ok(username && password, 'Set TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD.');
  assert.ok(typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) && Number(rawId) <= 2147483647,
    'Set TEST_STAFF_BOOKING_ID to the booking reference you just checked in (digits only).');
  const bookingId = Number(rawId);
  let refreshToken;
  try {
    const login = await request('/auth/staff/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, 'Staff login failed.');
    refreshToken = login.data.refreshToken;
    const token = login.data.token || login.data.accessToken;
    assert.ok(token, 'Access token missing.');
    assert.ok(['Receptionist', 'Manager', 'Admin'].includes(login.data.staff?.role),
      'Use a front-desk test account for this check.');

    const detail = await request(`/bookings/${bookingId}`, { token });
    assert.equal(detail.status, 200, 'Booking details could not be loaded.');
    assert.equal(detail.data.BookingID, bookingId);
    assert.equal(detail.data.BookingStatus, 'Checked-In', 'Check in this reservation through the staff page first.');
    assert.ok(Array.isArray(detail.data.rooms) && detail.data.rooms.length, 'Booking has no rooms.');
    assert.equal(detail.data.checkInEligibility?.allowed, false, 'Already checked-in bookings must not offer another check-in.');
    let estimatedRoomCharge = 0;
    for (const room of detail.data.rooms) {
      assert.equal(room.RoomStatus, 'Occupied', `Room ${room.RoomNumber} must be Occupied.`);
      const nights = (Date.parse(`${room.CheckOutDate}T00:00:00Z`) - Date.parse(`${room.CheckInDate}T00:00:00Z`)) / 86400000;
      assert.ok(Number.isInteger(nights) && nights > 0, 'Stay dates are invalid.');
      assert.ok(typeof room.DailyRate === 'number' && room.DailyRate >= 0, 'Room rate is invalid.');
      estimatedRoomCharge += nights * room.DailyRate;
    }

    const filtered = await request(`/bookings?bookingId=${bookingId}`, { token });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.length, 1, 'Reference search should return this booking only.');
    assert.equal(filtered.data[0].BookingID, bookingId);
    assert.equal(filtered.data[0].BookingStatus, 'Checked-In');

    const response = await request(`/bookings/${bookingId}/bill`, { token });
    assert.equal(response.status, 200, 'The opened bill could not be loaded.');
    const { bill, roomCharges, serviceCharges, totalAmount, outstandingBalance, payments, serviceUsage } = response.data;
    assert.ok(Number.isSafeInteger(bill?.BillID) && bill.BillID > 0, 'Check-in must open a bill.');
    assert.equal(bill.BookingID, bookingId);
    assert.equal(bill.BillStatus, 'Unpaid', 'Use a fresh test stay without payments.');
    assert.deepEqual(payments, [], 'This check expects no recorded payments.');
    assert.deepEqual(serviceUsage, [], 'This check expects no services yet.');
    closeTo(roomCharges, estimatedRoomCharge, 'Room charge does not match the current rate and stay length.');
    closeTo(bill.RoomCharges, estimatedRoomCharge, 'Stored room charge is incorrect.');
    closeTo(serviceCharges, 0, 'A fresh stay should have zero service charges.');
    closeTo(bill.ServiceCharges, 0, 'Stored service charges should be zero.');
    closeTo(totalAmount, estimatedRoomCharge, 'Bill total is incorrect.');
    closeTo(bill.TotalAmount, estimatedRoomCharge, 'Stored bill total is incorrect.');
    closeTo(outstandingBalance, estimatedRoomCharge, 'Unpaid balance should equal the bill total.');
    console.log(`PASS: booking #${bookingId} Checked-In, ${detail.data.rooms.length} room(s) Occupied, bill #${bill.BillID} Unpaid, LKR ${totalAmount.toFixed(2)} outstanding, no services or payments.`);
    console.log('The stay remains Checked-In for the next services and billing steps.');
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
