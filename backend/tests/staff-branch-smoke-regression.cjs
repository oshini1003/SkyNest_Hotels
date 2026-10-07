'use strict';
const assert = require('node:assert/strict');
const { configuration, run } = require('../test-staff-branch-access');

const config = configuration({ TEST_STAFF_USERNAME: 'frontdesk', TEST_STAFF_PASSWORD: 'test',
  TEST_MANAGER_USERNAME: 'manager', TEST_MANAGER_PASSWORD: 'test',
  TEST_STAFF_OWN_BOOKING_ID: '81', TEST_STAFF_OTHER_BOOKING_ID: '92' });

function fixture(mode = '') {
  const calls = [];
  const history = {
    '/bookings/81': { BookingID: 81, rooms: [{ BranchID: 7 }] },
    '/bookings/92': { BookingID: 92, rooms: [{ BranchID: 13 }] },
    '/bookings/81/bill': { bookingId: 81, totalAmount: 13000, paidAmount: 5000, payments: [{ PaymentID: 6 }] },
    '/bookings/92/bill': { bookingId: 92, totalAmount: 8000, paidAmount: 0, payments: [] },
    '/service-usage/81': [{ UsageID: 5, PriceAtUsage: '1500.00' }],
    '/service-usage/92': [],
  };
  const readCounts = new Map();
  async function request(api, path, token, body) {
    calls.push({ api, path, token, body });
    if (body !== undefined) {
      assert.ok(['/auth/staff/login', '/auth/logout'].includes(path), 'Smoke test must never mutate hotel endpoints.');
      if (path === '/auth/logout') return { status: 200, data: {} };
      const manager = body.username === 'manager';
      return { status: 200, data: { token: manager ? 'manager-token' : 'staff-token',
        refreshToken: manager ? 'manager-refresh' : 'staff-refresh',
        staff: { staffId: manager ? 11 : 22, role: manager ? 'Manager' : 'Receptionist' } } };
    }
    if (path === '/staff/scope') {
      if (!token) return { status: 401, data: {} };
      return { status: 200, data: token === 'manager-token'
        ? { staffId: 11, role: 'Manager', branchId: null, branchName: null }
        : { staffId: 22, role: 'Receptionist', branchId: 7, branchName: 'Test branch' } };
    }
    if (path === '/bookings') return { status: 200, data: mode === 'list-leak'
      ? [history['/bookings/81'], history['/bookings/92']] : [history['/bookings/81']] };
    if (path === '/bookings?bookingId=92') return { status: 200, data: [] };
    if (path === '/bookings?branchId=13') return { status: mode === 'filter-leak' ? 200 : 403,
      data: mode === 'filter-leak' ? [history['/bookings/92']] : { error: 'Forbidden' } };
    assert.ok(Object.hasOwn(history, path), 'Unexpected request path.');
    if (token === 'staff-token' && path.endsWith('/92')) {
      if (mode === 'detail-leak' && path === '/bookings/92') return { status: 200, data: history[path] };
      return { status: 404, data: { error: mode === 'disclosing-error' ? 'Guest in another branch' : 'Booking not found.' } };
    }
    if (token === 'staff-token' && path === '/bookings/92/bill') {
      return mode === 'bill-leak' ? { status: 200, data: history[path] }
        : { status: 404, data: { error: 'Booking not found.' } };
    }
    readCounts.set(path, (readCounts.get(path) || 0) + 1);
    if (mode === 'history-changed' && token === 'manager-token' && path === '/bookings/81/bill' && readCounts.get(path) > 2) {
      return { status: 200, data: { ...history[path], paidAmount: 6000 } };
    }
    return { status: 200, data: structuredClone(history[path]) };
  }
  return { request, calls };
}

(async () => {
  const valid = fixture();
  assert.deepEqual(await run(config, valid.request), { staffId: 22, branchId: 7, own: 81, other: 92 });
  assert.equal(valid.calls.filter(call => call.path === '/auth/logout').length, 2);
  for (const mode of ['list-leak', 'filter-leak', 'detail-leak', 'bill-leak', 'disclosing-error', 'history-changed']) {
    const scenario = fixture(mode);
    await assert.rejects(run(config, scenario.request), { code: 'ERR_ASSERTION' }, mode);
    assert.equal(scenario.calls.filter(call => call.path === '/auth/logout').length, 2, 'Failure must close both test sessions.');
  }
  for (const url of ['https://example.com/api', 'http://user:password@localhost/api', 'http://localhost/api?x=1']) {
    assert.throws(() => configuration({ TEST_API_URL: url }), { code: 'ERR_ASSERTION' });
  }
  console.log('PASS: live-checker fixtures reject foreign data/error leaks, filter bypass and changed history; hotel calls remain GET-only and sessions close on failures (mock API).');
})().catch(error => { console.error(error); process.exitCode = 1; });
