'use strict';
const assert = require('node:assert/strict');
const { configuration, run } = require('../test-guest-bill');

const env = { TEST_GUEST_USERNAME: 'owner', TEST_GUEST_PASSWORD: 'test',
  TEST_OTHER_GUEST_USERNAME: 'other', TEST_OTHER_GUEST_PASSWORD: 'test', TEST_GUEST_BOOKING_ID: '81' };
const config = configuration(env);

function fixture(mode = '') {
  const calls = [];
  const service = { UsageID: 18, BookingID: 81, ServiceID: 4, ServiceName: 'Test service',
    Quantity: 3, PriceAtUsage: '0.10', LineTotal: '0.30', UsageDateDisplay: '2026-10-07 08:30:00' };
  const payment = { PaymentID: 28, BookingID: 81, BillID: 6, Amount: '6000.10', PaymentMethod: 'Cash',
    PaymentType: 'Partial', PaymentDateDisplay: '2026-10-07 09:00:00' };
  const history = {
    '/bookings/81': { BookingID: 81, GuestID: 5, BookingStatus: 'Checked-In', rooms: [{ RoomID: 8, BranchID: 1 }] },
    '/bookings/81/bill': { bookingId: 81, bookingStatus: 'Checked-In', roomCharges: 12000,
      serviceCharges: 0.3, totalAmount: 12000.3, paidAmount: 6000.1, outstandingBalance: 6000.2,
      bill: { BillID: 6, BookingID: 81, RoomCharges: '12000.00', ServiceCharges: '0.30',
        TotalAmount: '12000.30', BillStatus: 'Partially Paid' }, payments: [payment], serviceUsage: [service] },
    '/service-usage/81': [structuredClone(service)],
  };
  const bill = history['/bookings/81/bill'];
  if (mode === 'wrong-owner') history['/bookings/81'].GuestID = 9;
  if (mode === 'estimate') bill.bill = null;
  if (mode === 'wrong-bill-booking') bill.bill.BookingID = 82;
  if (mode === 'wrong-response-total') bill.totalAmount = 12000.31;
  if (mode === 'wrong-stored-total') bill.bill.TotalAmount = '12000.31';
  if (mode === 'wrong-line-total') bill.serviceUsage[0].LineTotal = '0.31';
  if (mode === 'wrong-saved-price') bill.serviceUsage[0].PriceAtUsage = '0.11';
  if (mode === 'wrong-paid') bill.paidAmount = 6000.11;
  if (mode === 'wrong-outstanding') bill.outstandingBalance = 6000.21;
  if (mode === 'wrong-payment-bill') bill.payments[0].BillID = 7;
  if (mode === 'duplicate-service') bill.serviceUsage.push(structuredClone(service));
  if (mode === 'duplicate-payment') bill.payments.push(structuredClone(payment));
  if (mode === 'wrong-status') bill.bill.BillStatus = 'Paid';
  if (mode === 'negative-price') bill.serviceUsage[0].PriceAtUsage = '-0.10';
  if (mode === 'fractional-cent') bill.payments[0].Amount = '6000.101';
  if (mode === 'service-disagreement') history['/service-usage/81'][0].ServiceName = 'Changed service';
  if (mode === 'complete') {
    history['/bookings/81'].BookingStatus = bill.bookingStatus = 'Checked-Out';
    bill.payments.push({ ...payment, PaymentID: 29, Amount: '6000.20', PaymentType: 'Full' });
    bill.paidAmount = bill.totalAmount;
    bill.outstandingBalance = 0;
    bill.bill.BillStatus = 'Paid';
  }
  const reads = new Map();
  async function request(api, path, token, body) {
    calls.push({ path, token, body });
    assert.equal(api, config.api);
    if (body !== undefined) {
      assert.ok(['/auth/guest/login', '/auth/logout'].includes(path), 'Smoke test must never write hotel data.');
      if (path === '/auth/logout') return { status: mode === 'logout-failure' ? 500 : 200, data: {} };
      const other = body.username === 'other';
      if (mode === 'second-login-failure' && other) return { status: 401, data: {} };
      return { status: 200, data: { token: other ? 'other-token' : 'owner-token',
        refreshToken: other ? 'other-refresh' : 'owner-refresh',
        guest: { guestId: other && mode !== 'same-guest' ? 9 : 5 } } };
    }
    assert.ok(Object.hasOwn(history, path), 'Unexpected hotel request.');
    if (!token) return { status: mode === 'anonymous-leak' ? 200 : 401, data: {} };
    if (token === 'other-token') {
      if (mode === 'foreign-detail' && path === '/bookings/81'
        || mode === 'foreign-bill' && path === '/bookings/81/bill'
        || mode === 'foreign-service' && path === '/service-usage/81') return { status: 200, data: history[path] };
      return { status: 404, data: mode === 'foreign-error-details'
        ? { error: 'Booking not found.', owner: 5 } : { error: 'Booking not found.' } };
    }
    reads.set(path, (reads.get(path) || 0) + 1);
    if (mode === 'network-failure' && path === '/bookings/81/bill') throw new Error('Synthetic transport error');
    const data = structuredClone(history[path]);
    if (mode === 'history-changed' && path === '/bookings/81/bill' && reads.get(path) > 1) data.bill.StaffID = 3;
    return { status: 200, data };
  }
  return { request, calls };
}

(async () => {
  for (const mode of ['', 'complete']) {
    const scenario = fixture(mode);
    assert.deepEqual(await run(config, scenario.request), { bookingId: 81, billId: 6, services: 1,
      payments: mode === 'complete' ? 2 : 1 });
    assert.equal(scenario.calls.filter(call => call.path === '/auth/logout').length, 2);
    assert.ok(scenario.calls.filter(call => call.body !== undefined)
      .every(call => ['/auth/guest/login', '/auth/logout'].includes(call.path)));
  }
  for (const mode of ['wrong-owner', 'same-guest', 'estimate', 'wrong-bill-booking', 'wrong-response-total',
    'wrong-stored-total', 'wrong-line-total', 'wrong-saved-price', 'wrong-paid', 'wrong-outstanding',
    'wrong-payment-bill', 'duplicate-service', 'duplicate-payment', 'wrong-status', 'negative-price',
    'fractional-cent', 'service-disagreement', 'anonymous-leak', 'foreign-detail', 'foreign-bill',
    'foreign-service', 'foreign-error-details', 'history-changed', 'logout-failure']) {
    const scenario = fixture(mode);
    await assert.rejects(run(config, scenario.request), { code: 'ERR_ASSERTION' }, mode);
    assert.equal(scenario.calls.filter(call => call.path === '/auth/logout').length, 2,
      'Both test sessions must receive cleanup attempts even on failure.');
  }
  const transport = fixture('network-failure');
  await assert.rejects(run(config, transport.request), /Synthetic transport error/);
  assert.equal(transport.calls.filter(call => call.path === '/auth/logout').length, 2);
  const login = fixture('second-login-failure');
  await assert.rejects(run(config, login.request), { code: 'ERR_ASSERTION' });
  assert.equal(login.calls.filter(call => call.path === '/auth/logout').length, 1);
  for (const value of ['', '0', '01', '2147483648', '1e2', ' 81', 81]) {
    assert.throws(() => configuration({ ...env, TEST_GUEST_BOOKING_ID: value }), { code: 'ERR_ASSERTION' });
  }
  for (const url of ['https://example.com/api', 'http://localhost.example.com/api', 'http://user:password@localhost/api',
    'http://localhost/api?x=1', 'http://localhost/api#fragment', 'file:///api']) {
    assert.throws(() => configuration({ ...env, TEST_API_URL: url }), { code: 'ERR_ASSERTION' });
  }
  for (const key of ['TEST_GUEST_USERNAME', 'TEST_GUEST_PASSWORD', 'TEST_OTHER_GUEST_USERNAME', 'TEST_OTHER_GUEST_PASSWORD']) {
    assert.throws(() => configuration({ ...env, [key]: '' }), { code: 'ERR_ASSERTION' });
  }
  console.log('PASS: guest-bill smoke fixtures reject ownership/authentication leaks, estimates, wrong saved totals/prices/payments and changed history; exact cents, GET-only hotel calls and session cleanup (mock API, no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
