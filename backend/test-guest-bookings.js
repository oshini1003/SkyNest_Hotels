// Run against the local integration API with two different test guest accounts.
// Creates test reservation(s), then cancels only reservations created by this run.
// Cancelled rows remain in the database. No schema, seed, bill or payment writes.
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

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function run() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname),
    'This test is intended for the local integration API only.');
  const credentials = [
    { username: process.env.TEST_GUEST_USERNAME, password: process.env.TEST_GUEST_PASSWORD },
    { username: process.env.TEST_OTHER_GUEST_USERNAME, password: process.env.TEST_OTHER_GUEST_PASSWORD },
  ];
  assert.ok(credentials.every(item => item.username && item.password),
    'Set TEST_GUEST_USERNAME, TEST_GUEST_PASSWORD, TEST_OTHER_GUEST_USERNAME and TEST_OTHER_GUEST_PASSWORD.');
  const sessions = [];
  const createdIds = new Set();
  const cancelledIds = new Set();
  let ownerToken;
  let checksPassed = false;

  try {
    for (const body of credentials) {
      const login = await request('/auth/guest/login', { method: 'POST', body });
      assert.equal(login.status, 200, 'Test guest login failed.');
      sessions.push(login.data);
    }
    const [owner, other] = sessions;
    ownerToken = owner.token || owner.accessToken;
    const otherToken = other.token || other.accessToken;
    assert.ok(ownerToken && otherToken, 'Access token missing.');
    assert.ok(owner.guest?.guestId && other.guest?.guestId, 'Guest identity missing.');
    assert.notEqual(owner.guest.guestId, other.guest.guestId, 'Use two different guest accounts.');

    const checkin = futureDate(14);
    const checkout = futureDate(16);
    const stayQuery = new URLSearchParams({ checkin, checkout, guestCount: '1' });
    const available = await request(`/rooms?${stayQuery}`);
    assert.equal(available.status, 200, 'Room search failed.');
    assert.ok(Array.isArray(available.data) && available.data.length, 'No room available for the test dates.');
    const roomId = available.data[0].RoomID;
    const body = {
      roomId, checkin, checkout, guestCount: 1, paymentMethod: 'Cash',
      guestId: other.guest.guestId, // Must be ignored: the access token identifies the owner.
    };

    // Two simultaneous requests must never reserve the same room and dates twice.
    // Capture every returned ID before asserting so cleanup handles a failed guard too.
    const attempts = await Promise.allSettled([1, 2].map(async () => {
      const result = await request('/bookings', { token: ownerToken, method: 'POST', body });
      if (result.status === 201 && Number.isSafeInteger(result.data?.bookingId)) {
        createdIds.add(result.data.bookingId);
      }
      return result;
    }));
    assert.ok(attempts.every(item => item.status === 'fulfilled'),
      'A creation response was lost. Check My bookings before running this test again.');
    const results = attempts.map(item => item.value);
    assert.deepEqual(results.map(item => item.status).sort(), [201, 409],
      'Expected one reservation and one overlap rejection from concurrent requests.');
    assert.equal(createdIds.size, 1, 'Exactly one booking ID must be returned.');
    const bookingId = [...createdIds][0];
    console.log(`Created test booking #${bookingId}; concurrent overlap rejected.`);

    const detail = await request(`/bookings/${bookingId}`, { token: ownerToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.GuestID, owner.guest.guestId, 'Client-supplied guestId changed ownership.');
    assert.equal(detail.data.BookingStatus, 'Booked');
    assert.equal(detail.data.PreferredPaymentMethod, 'Cash');
    assert.equal(detail.data.rooms.length, 1);
    assert.equal(detail.data.rooms[0].RoomID, roomId);
    assert.equal(detail.data.rooms[0].CheckInDate, checkin);
    assert.equal(detail.data.rooms[0].CheckOutDate, checkout);
    assert.equal(detail.data.rooms[0].GuestCount, 1);

    const ownList = await request('/bookings', { token: ownerToken });
    assert.equal(ownList.status, 200);
    assert.ok(ownList.data.some(item => item.BookingID === bookingId && item.rooms.length === 1));
    const foreignList = await request(`/bookings?guestId=${owner.guest.guestId}`, { token: otherToken });
    assert.equal(foreignList.status, 200);
    assert.ok(foreignList.data.every(item => item.GuestID === other.guest.guestId), 'List leaked another guest\'s booking.');
    assert.equal((await request(`/bookings/${bookingId}`, { token: otherToken })).status, 404);
    assert.equal((await request(`/bookings/${bookingId}/cancel`, { token: otherToken, method: 'PATCH' })).status, 404);
    assert.equal((await request(`/service-usage/${bookingId}`, { token: otherToken })).status, 404);
    const usage = await request(`/service-usage/${bookingId}`, { token: ownerToken });
    assert.equal(usage.status, 200);
    assert.deepEqual(usage.data, []);

    const roomQuery = new URLSearchParams({ ...Object.fromEntries(stayQuery), roomId: String(roomId) });
    const unavailable = await request(`/rooms?${roomQuery}`);
    assert.equal(unavailable.status, 200);
    assert.deepEqual(unavailable.data, [], 'Booked room still appeared for the same stay.');

    const bill = await request(`/bookings/${bookingId}/bill`, { token: ownerToken });
    assert.equal(bill.status, 200);
    assert.equal(bill.data.bill, null, 'A reservation must not create a bill before check-in.');
    assert.deepEqual(bill.data.payments, [], 'A payment preference must not record a payment.');

    const cancel = await request(`/bookings/${bookingId}/cancel`, { token: ownerToken, method: 'PATCH' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.status, 'Cancelled');
    cancelledIds.add(bookingId);
    assert.equal((await request(`/bookings/${bookingId}/cancel`, { token: ownerToken, method: 'PATCH' })).status, 409);
    const cancelled = await request(`/bookings/${bookingId}`, { token: ownerToken });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.BookingStatus, 'Cancelled');
    const released = await request(`/rooms?${roomQuery}`);
    assert.equal(released.status, 200);
    assert.ok(released.data.some(room => room.RoomID === roomId), 'Cancelled stay still blocked the room.');
    checksPassed = true;
  } finally {
    for (const id of createdIds) {
      if (cancelledIds.has(id)) continue;
      // Try both test identities only for IDs created here, so a failed ownership
      // assertion does not leave a reservation belonging to the other test guest.
      for (const session of sessions) {
        const token = session.token || session.accessToken;
        try {
          const result = await request(`/bookings/${id}/cancel`, { token, method: 'PATCH' });
          if (result.status === 200) {
            cancelledIds.add(id);
            break;
          }
          const detail = await request(`/bookings/${id}`, { token });
          if (detail.status === 200 && detail.data.BookingStatus === 'Cancelled') {
            cancelledIds.add(id);
            break;
          }
        } catch { /* Report below if neither identity confirms cleanup. */ }
      }
      if (!cancelledIds.has(id)) {
        console.error(`Cleanup not confirmed for test booking #${id}. Check it in My bookings.`);
        process.exitCode = 1;
      }
    }
    for (const session of sessions) {
      if (!session.refreshToken) continue;
      await request('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } }).catch(() => {});
    }
  }
  if (checksPassed && !process.exitCode) {
    console.log('PASS: live creation, concurrent overlap rejection, guest ownership, booking lists/dates, no payment, cancellation and restored availability. Test reservation remains as Cancelled.');
  }
}

run().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
