// Actual Vite-loaded guest bill client with independent financial fixtures.
// Browser storage and HTTP are mocked; no backend or hotel rows are changed.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const original = Object.fromEntries(["window", "sessionStorage", "fetch", "setTimeout"]
  .map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
let server;
let calls = [];
let respond;
function replace(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) };
}
function token(label) {
  return `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
function estimate(status = "Booked") {
  return { bookingId: 8, bookingStatus: status, roomCharges: 12000, serviceCharges: 0,
    totalAmount: 12000, paidAmount: 0, outstandingBalance: 12000, bill: null, payments: [], serviceUsage: [] };
}
function partial() {
  return { bookingId: 8, bookingStatus: "Checked-In", roomCharges: 12000, serviceCharges: 1500,
    totalAmount: 13500, paidAmount: 6750, outstandingBalance: 6750,
    bill: { BillID: 4, BookingID: 8, StaffID: null, RoomCharges: "12000.00", ServiceCharges: "1500.00",
      TotalAmount: "13500.00", BillStatus: "Partially Paid", GeneratedDate: "2026-10-07T02:30:00.000Z" },
    payments: [{ PaymentID: 9, BookingID: 8, BillID: 4, PaymentType: "Partial", Amount: "6750.00",
      PaymentMethod: "Cash", PaymentDateDisplay: "2026-10-07 09:00:00" }],
    serviceUsage: [{ UsageID: 5, BookingID: 8, ServiceID: 5, Quantity: 1, PriceAtUsage: "1500.00",
      ServiceName: "Breakfast Buffet", LineTotal: "1500.00", UsageDateDisplay: "2026-10-07 08:15:00" }] };
}
function completed() {
  const data = partial();
  data.bookingStatus = "Checked-Out";
  data.bill.StaffID = 3;
  data.bill.BillStatus = "Paid";
  data.paidAmount = 13500;
  data.outstandingBalance = 0;
  data.payments.push({ PaymentID: 10, BookingID: 8, BillID: 4, PaymentType: "Full", Amount: 6750,
    PaymentMethod: "Card", PaymentDateDisplay: "2026-10-08 10:00:00" });
  return data;
}
function pendingResponse() {
  let finish;
  respond = () => new Promise((resolve) => { finish = resolve; });
  return (data, status = 200) => finish(response(data, status));
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return respond(url, options); });
  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const { loadGuestBill: load, guestBillId: id, formatBillMoney: money } = await server.ssrLoadModule("/src/services/guestBillingApi.js");
  const session = await server.ssrLoadModule("/src/services/session.js");
  const intent = await server.ssrLoadModule("/src/services/bookingIntent.js");
  await server.close();
  server = null;
  const guestToken = token("original-guest");
  const newToken = token("new-guest");
  const staffToken = token("staff");
  function login(accessToken = guestToken, guestId = 2) {
    session.saveSession("guest", { token: accessToken, guest: { guestId, name: "Test guest" } });
  }
  function reset() { storage.clear(); calls = []; login(); respond = () => response(partial()); }
  const status = (expected) => (error) => error.status === expected;
  const cancelled = (error) => error.name === "AbortError";
  const unverified = (error) => /could not be verified/.test(error.message);

  reset();
  for (const value of [undefined, null, "", "0", 0, -1, 1.1, "01", "+1", "1.0", "1e1", " 8", "8 ", "8/bill", "8?guest=2",
    "2147483648", 2147483648, NaN, Infinity, [], {}, true, "9".repeat(100)]) {
    assert.equal(id(value), null);
    await assert.rejects(load(value, guestToken), status(400));
  }
  assert.equal(calls.length, 0, "Malformed references must not issue requests.");
  for (const value of [1, "1", 2147483647, "2147483647"]) assert.equal(id(value), Number(value));
  storage.clear();
  await assert.rejects(load(8, guestToken), status(401));
  session.saveSession("staff", { token: staffToken, staff: { staffId: 3, role: "Receptionist" } });
  await assert.rejects(load(8, staffToken), status(401));
  login();
  await assert.rejects(load(8, newToken), status(401));
  login(guestToken, 0);
  await assert.rejects(load(8, guestToken), status(401));
  assert.equal(calls.length, 0, "Guest identity is required before fetching financial history.");

  assert.equal(money(0), "LKR 0.00");
  assert.equal(money(13500), "LKR 13,500.00");
  assert.equal(money("59.97"), "LKR 59.97");
  assert.equal(money("0.1"), "LKR 0.10");
  assert.equal(money(-0.01), "LKR -0.01");
  assert.equal(money("9007199254740993.01"), "LKR 9,007,199,254,740,993.01");
  for (const amount of [undefined, null, [], {}, "", " 1.00", "1.00 ", "1e3", "1.001", "NaN", NaN, Infinity,
    "01.00", "1,000.00", "9".repeat(40), Number.MAX_SAFE_INTEGER]) assert.equal(money(amount), "Unavailable");

  reset();
  for (const data of [estimate(), estimate("Cancelled"), partial(), completed()]) {
    respond = () => response(data);
    assert.deepEqual(await load("8", guestToken), data, "The verified response keeps the original backend shape.");
  }
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(call.url, /\/bookings\/8\/bill$/);
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.headers.Authorization, `Bearer ${guestToken}`);
  }

  // Independent cents fixture: 12.01 room + 3 x 19.99 historical service = 71.98.
  // Current catalogue prices are intentionally irrelevant to this response.
  const centsFixture = partial();
  Object.assign(centsFixture, { roomCharges: 12.01, serviceCharges: 59.97, totalAmount: 71.98, paidAmount: 12.3, outstandingBalance: 59.68 });
  Object.assign(centsFixture.bill, { RoomCharges: 12.01, ServiceCharges: 59.97, TotalAmount: 71.98 });
  Object.assign(centsFixture.serviceUsage[0], { Quantity: 3, PriceAtUsage: 19.99, LineTotal: 59.97, UnitPrice: 999 });
  centsFixture.payments = [
    { ...partial().payments[0], Amount: 12.01, PaymentID: 1 },
    { ...partial().payments[0], Amount: 0.1, PaymentID: 2 },
    { ...partial().payments[0], Amount: 0.19, PaymentID: 3 },
  ];
  respond = () => response(centsFixture);
  assert.deepEqual(await load(8, guestToken), centsFixture);

  const credit = completed();
  credit.payments[1].Amount = "6750.01";
  credit.paidAmount = 13500.01;
  credit.outstandingBalance = -0.01;
  respond = () => response(credit);
  assert.deepEqual(await load(8, guestToken), credit, "A reconciled saved credit is retained, not rounded away.");

  const freeStay = partial();
  Object.assign(freeStay, { roomCharges: 0, serviceCharges: 0, totalAmount: 0, paidAmount: 0, outstandingBalance: 0,
    payments: [], serviceUsage: [] });
  Object.assign(freeStay.bill, { RoomCharges: 0, ServiceCharges: 0, TotalAmount: 0, BillStatus: "Unpaid" });
  respond = () => response(freeStay);
  assert.deepEqual(await load(8, guestToken), freeStay);

  for (const mutate of [
    (data) => { data.bookingId = 9; }, (data) => { data.bookingId = "08"; },
    (data) => { data.bookingStatus = "No-show"; }, (data) => { data.bookingStatus = "Booked"; },
    (data) => { data.bill = null; }, (data) => { data.bill = []; }, (data) => { delete data.bill; },
    (data) => { data.bill.BillID = 0; }, (data) => { data.bill.BookingID = 9; },
    (data) => { data.bill.StaffID = "01"; }, (data) => { data.bill.BillStatus = "Paid"; },
    (data) => { data.bill.RoomCharges = 14000; }, (data) => { data.bill.ServiceCharges = 0; },
    (data) => { data.bill.TotalAmount = "13500.01"; },
    (data) => { data.roomCharges = -12000; }, (data) => { data.totalAmount = null; },
    (data) => { data.paidAmount = "6750.001"; }, (data) => { data.outstandingBalance = 6750.01; },
    (data) => { data.paidAmount = 6751; data.outstandingBalance = 6749; },
    (data) => { data.totalAmount = 13501; data.bill.TotalAmount = 13501; data.outstandingBalance = 6751; },
    (data) => { data.payments = null; }, (data) => { data.payments = [null]; },
    (data) => { data.payments[0].PaymentID = "09"; }, (data) => { data.payments[0].BookingID = 9; },
    (data) => { data.payments[0].BillID = 5; }, (data) => { data.payments[0].Amount = 0; },
    (data) => { data.payments[0].PaymentMethod = "Crypto"; }, (data) => { data.payments[0].PaymentType = "Deposit"; },
    (data) => { data.payments[0].PaymentDateDisplay = "2026-02-30 09:00:00"; },
    (data) => { data.payments[0].PaymentDateDisplay = "2026-10-07T09:00:00Z"; },
    (data) => { data.payments.push({ ...data.payments[0] }); data.paidAmount = 13500; data.outstandingBalance = 0; data.bill.BillStatus = "Paid"; },
    (data) => { data.serviceUsage = {}; }, (data) => { data.serviceUsage = [null]; },
    (data) => { data.serviceUsage[0].UsageID = 2147483648; }, (data) => { data.serviceUsage[0].BookingID = 9; },
    (data) => { data.serviceUsage[0].ServiceID = 0; }, (data) => { data.serviceUsage[0].Quantity = 1.5; },
    (data) => { data.serviceUsage[0].ServiceName = "   "; }, (data) => { data.serviceUsage[0].UsageDateDisplay = "2026-10-07 25:00:00"; },
    (data) => { data.serviceUsage[0].PriceAtUsage = "1500.001"; }, (data) => { data.serviceUsage[0].LineTotal = 1501; },
    (data) => { data.serviceUsage[0].Quantity = 2; },
    (data) => { data.serviceUsage[0].PriceAtUsage = 1; data.serviceUsage[0].LineTotal = 1; },
    (data) => { data.serviceUsage.push({ ...data.serviceUsage[0] }); data.serviceCharges = 3000;
      data.bill.ServiceCharges = 3000; data.totalAmount = 15000; data.bill.TotalAmount = 15000; data.outstandingBalance = 8250; },
    (data) => { data.roomCharges = 100000000; data.bill.RoomCharges = 100000000; data.totalAmount = 100001500;
      data.bill.TotalAmount = 100001500; data.outstandingBalance = 99994750; },
  ]) {
    const bad = partial(); mutate(bad); respond = () => response(bad);
    await assert.rejects(load(8, guestToken), unverified);
  }
  for (const bad of [null, [], {}, true, "private data"]) {
    respond = () => response(bad); await assert.rejects(load(8, guestToken), unverified);
  }
  for (const mutate of [
    (data) => { data.bookingStatus = "Checked-In"; },
    (data) => { data.bookingStatus = "Checked-Out"; },
    (data) => { data.payments = partial().payments; },
    (data) => { data.serviceUsage = partial().serviceUsage; },
    (data) => { data.serviceCharges = 1500; data.totalAmount = 13500; data.outstandingBalance = 13500; },
  ]) { const bad = estimate(); mutate(bad); respond = () => response(bad); await assert.rejects(load(8, guestToken), unverified); }
  const outstandingCheckout = partial(); outstandingCheckout.bookingStatus = "Checked-Out"; outstandingCheckout.bill.StaffID = 3;
  respond = () => response(outstandingCheckout); await assert.rejects(load(8, guestToken), unverified);
  const unfinishedBill = completed(); unfinishedBill.bill.StaffID = null;
  respond = () => response(unfinishedBill); await assert.rejects(load(8, guestToken), unverified);

  for (const code of [400, 403, 404, 429, 500, 502]) {
    respond = () => response({ error: "PRIVATE SQL: foreign guest 2" }, code);
    await assert.rejects(load(8, guestToken), (error) => error.status === code && !/PRIVATE|foreign|guest 2/.test(error.message));
  }
  for (const serverError of ["Booking not found.", "Booking belongs to another guest."]) {
    respond = () => response({ error: serverError }, 404);
    await assert.rejects(load(8, guestToken), (error) => error.message === "This booking could not be found.");
  }
  respond = () => response(partial(), 202); await assert.rejects(load(8, guestToken), unverified);
  respond = () => ({ status: 200, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(load(8, guestToken), unverified);
  respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(load(8, guestToken), /billing service is unavailable/);

  reset();
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(load(8, guestToken, alreadyAborted.signal), cancelled);
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  const finishAborted = pendingResponse();
  const oldBooking = load(8, guestToken, controller.signal);
  const oldBookingCheck = assert.rejects(oldBooking, cancelled);
  controller.abort(); finishAborted(partial()); await oldBookingCheck;

  for (const code of [200, 401]) {
    reset();
    const finish = pendingResponse();
    const oldSession = load(8, guestToken);
    const check = assert.rejects(oldSession, cancelled);
    login(newToken, 5);
    finish(code === 200 ? partial() : { error: "PRIVATE AUTH" }, code);
    await check;
    assert.equal(session.readSession("guest").token, newToken, "An old response must preserve a newer sign-in.");
    assert.equal(session.readSessionNotice("guest"), "");
  }
  reset();
  const finishSignedOut = pendingResponse();
  const oldLogin = load(8, guestToken);
  const signOutCheck = assert.rejects(oldLogin, cancelled);
  session.clearSession("guest"); finishSignedOut(partial()); await signOutCheck;
  assert.equal(session.readSessionNotice("guest"), "");
  reset();
  session.saveSession("staff", { token: staffToken, staff: { staffId: 3, role: "Receptionist" } });
  respond = () => response({ error: "PRIVATE AUTH" }, 401);
  await assert.rejects(load(8, guestToken), status(401));
  assert.equal(session.readSession("guest"), null);
  assert.match(session.readSessionNotice("guest"), /expired/);
  assert.equal(session.readSession("staff").token, staffToken, "Guest expiry does not clear the independent staff session.");

  reset();
  const realSetTimeout = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
  await assert.rejects(load(8, guestToken), /took too long/);
  // Some fetch adapters still resolve after abort; never accept that late payload.
  respond = () => new Promise((resolve) => realSetTimeout(() => resolve(response(partial())), 10));
  await assert.rejects(load(8, guestToken), /took too long/);
  replace("setTimeout", realSetTimeout);
  assert.equal(session.readSession("guest").token, guestToken);

  for (const pathname of ["/guest/bookings/8/bill", "/guest/bookings/2147483647/bill"]) {
    const state = intent.guestSignInState(pathname);
    assert.deepEqual(state, { returnTo: pathname });
    assert.deepEqual(intent.guestReturnDestination(structuredClone(state)), { pathname }, "The same allowlisted state survives login or registration.");
  }
  for (const pathname of ["https://example.com", "//example.com", "/guest/bookings/08/bill", "/guest/bookings/0/bill",
    "/guest/bookings/-1/bill", "/guest/bookings/2147483648/bill", "/guest/bookings/8/bill?x=1", "/guest/bookings/8/bill#x",
    "/guest/bookings/8/bill/", "/guest/bookings/8%2F9/bill", "/guest/bookings/8/../bill", "/guest/bookings/8.0/bill"]) {
    assert.equal(intent.guestSignInState(pathname), undefined);
    assert.deepEqual(intent.guestReturnDestination({ returnTo: pathname }), { pathname: "/guest" });
  }
  assert.deepEqual(intent.guestSignInState("/guest/bookings"), { returnTo: "/guest/bookings" });
  assert.deepEqual(intent.guestReturnDestination({ returnTo: "/guest/bookings" }), { pathname: "/guest/bookings" });
  const future = new Date(); future.setUTCFullYear(future.getUTCFullYear() + 2);
  const arrival = future.toISOString().slice(0, 10); future.setUTCDate(future.getUTCDate() + 2);
  const stay = { roomId: 3, checkin: arrival, checkout: future.toISOString().slice(0, 10), guests: 2 };
  const stayState = intent.guestSignInState("/make-booking", { stay });
  assert.deepEqual(stayState, { returnTo: "/make-booking", stay });
  assert.deepEqual(intent.guestReturnDestination(stayState), { pathname: "/make-booking", state: { stay } });

  console.log("PASS: guest bill estimates/history, exact saved charges and payment/service reconciliation, duplicate and malformed responses, safe GET-only requests, guest ownership error privacy, stale-session/abort/timeout handling and sign-in return destinations (actual Vite-loaded modules; mocked HTTP, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
