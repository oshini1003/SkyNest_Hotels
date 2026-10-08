// Load the real frontend module; HTTP and browser storage are independent test doubles.
// These checks never contact a backend or change hotel rows.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const names = ["window", "sessionStorage", "fetch", "setTimeout"];
const original = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
let server;
let calls = [];
let respond;
let rejectReads = false;
let rejectWrites = false;
let rejectRemoval = false;
let discardWrites = false;
let failSavedWrite = false;
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) };
}
function token(label) {
  return `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
const catalogue = [
  { ServiceID: 5, ServiceName: "Breakfast Buffet", Description: "Breakfast for one guest", UnitPrice: 1500, IsActive: 1 },
  { ServiceID: 6, ServiceName: "Laundry", Description: null, UnitPrice: "19.99", IsActive: true },
  { ServiceID: 7, ServiceName: "Retired service", Description: null, UnitPrice: 0, IsActive: false },
];
const entry = { bookingId: 8, serviceId: 5, quantity: 2 };
const key = "skynest_guest_service_attempt:4:8";
const pending = { guestId: 4, bookingId: 8, serviceId: 5, quantity: 2, stage: "pending" };
const status = (expected) => (error) => error.status === expected;
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const cancelled = (error) => error.name === "AbortError";

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (name) => { if (rejectReads) throw new Error("PRIVATE STORAGE"); return storage.get(name) ?? null; },
    setItem: (name, value) => {
      if (rejectWrites || (failSavedWrite && name.startsWith("skynest_guest_service_attempt:") && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE STORAGE");
      if (!discardWrites) storage.set(name, String(value));
    },
    removeItem: (name) => { if (rejectRemoval) throw new Error("PRIVATE STORAGE"); storage.delete(name); },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return respond(url, options); });
  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/guestServiceApi.js");
  const session = await server.ssrLoadModule("/src/services/session.js");
  const intent = await server.ssrLoadModule("/src/services/bookingIntent.js");
  await server.close(); server = null;
  const { guestServiceTotal: total, requestGuestService: request, loadGuestServiceCatalogue: load,
    readGuestServiceAttempt: read, clearGuestServiceAttempt: clear } = api;
  const guestToken = token("owner");
  const newToken = token("new-owner");
  function login(accessToken = guestToken, guestId = 4) {
    session.saveSession("guest", { token: accessToken, guest: { guestId, name: "Test guest" } });
  }
  function reset() {
    rejectReads = false; rejectWrites = false; rejectRemoval = false; discardWrites = false; failSavedWrite = false;
    storage.clear(); calls = []; login(); respond = () => response(entry, 201);
  }
  function pendingResponse() {
    let finish;
    respond = () => new Promise((resolve) => { finish = resolve; });
    return (data, code = 201) => finish(response(data, code));
  }

  reset();
  assert.equal(total(19.99, 3), "59.97");
  assert.equal(total("0.10", 3), "0.30");
  assert.equal(total(0, 2147483647), "0.00");
  assert.equal(total("99999999.99", 1), "99999999.99");
  assert.equal(total("33333333.33", 3), "99999999.99");
  assert.equal(total("50000000.00", 2), null);
  for (const bad of [null, undefined, true, [], {}, "", " 1.00", "1.00 ", "01.00", "+1", "1e3", "1.001", -1, NaN, Infinity, "100000000", "9".repeat(100)]) assert.equal(total(bad, 1), null);
  const invalidIds = [null, undefined, true, [], {}, "", "01", " 1", "1 ", "+1", "1e1", "1.0", 0, -1, 1.5, 2147483648, NaN, Infinity, "9".repeat(100)];
  for (const bad of invalidIds) {
    assert.equal(total(1, bad), null);
    for (const field of ["bookingId", "serviceId", "quantity"]) await assert.rejects(request({ ...entry, [field]: bad }, guestToken), status(400));
  }
  assert.equal(calls.length, 0);
  assert.equal(read(4, 8), null);
  storage.clear(); await assert.rejects(request(entry, guestToken), status(401));
  await assert.rejects(load(guestToken), status(401));
  login(); await assert.rejects(request(entry, newToken), status(401));
  login(guestToken, 0); await assert.rejects(request(entry, guestToken), status(401));
  assert.equal(calls.length, 0);

  reset();
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(request(entry, guestToken, preAborted.signal), cancelled);
  await assert.rejects(load(guestToken, preAborted.signal), cancelled);
  assert.equal(calls.length, 0); assert.equal(read(4, 8), null);

  reset();
  respond = () => {
    assert.deepEqual(read(4, 8), pending, "Persist the pending attempt before calling fetch.");
    return response(entry, 201);
  };
  assert.deepEqual(await request({ bookingId: "8", serviceId: "5", quantity: "2", guestId: 99, unitPrice: 0, actorType: "staff" }, guestToken), { ...entry, saved: true });
  assert.deepEqual(read(4, 8), { ...pending, stage: "saved" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/service-usage$/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${guestToken}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), entry, "Only server-accepted fields are submitted; price and actor remain server-owned.");
  await assert.rejects(request(entry, guestToken), unknown);
  assert.equal(calls.length, 1, "Known-saved markers also block duplicate POSTs until reconciliation.");
  clear(4, 8); assert.equal(read(4, 8), null);

  reset();
  const finishConcurrent = pendingResponse();
  const first = request(entry, guestToken);
  await assert.rejects(request(entry, guestToken), unknown);
  assert.throws(() => clear(4, 8), /wait for the current/);
  assert.equal(calls.length, 1);
  finishConcurrent(entry); await first; clear(4, 8);

  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    reset(); respond = () => response({ error: "PRIVATE SQL foreign guest 99" }, code);
    await assert.rejects(request(entry, guestToken), (error) => error.status === code && !error.outcomeUnknown && !/PRIVATE|foreign/.test(error.message));
    assert.equal(storage.has(key), false); assert.equal(calls.length, 1);
    if (code === 401) { assert.equal(session.readSession("guest"), null); assert.match(session.readSessionNotice("guest"), /expired/); }
  }
  for (const code of [200, 202, 204, 301, 408, 418, 500, 502, 504]) {
    reset(); respond = () => response(entry, code);
    await assert.rejects(request(entry, guestToken), unknown);
    assert.deepEqual(read(4, 8), pending); await assert.rejects(request(entry, guestToken), unknown); assert.equal(calls.length, 1);
  }
  for (const data of [null, [], {}, { ...entry, bookingId: 9 }, { ...entry, serviceId: 6 }, { ...entry, quantity: 1 }, { ...entry, quantity: "2" }]) {
    reset(); respond = () => response(data, 201);
    await assert.rejects(request(entry, guestToken), unknown); assert.deepEqual(read(4, 8), pending);
  }
  reset(); respond = () => ({ status: 201, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(request(entry, guestToken), unknown); assert.deepEqual(read(4, 8), pending);
  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(request(entry, guestToken), unknown); assert.deepEqual(read(4, 8), pending); assert.equal(calls.length, 1);

  // A new module instance after a page reload must also honour a saved pending marker.
  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const reloaded = await server.ssrLoadModule("/src/services/guestServiceApi.js");
  await server.close(); server = null;
  await assert.rejects(reloaded.requestGuestService(entry, guestToken), unknown); assert.equal(calls.length, 1);
  assert.deepEqual(reloaded.readGuestServiceAttempt(4, 8), pending);

  reset();
  const cancelledController = new AbortController();
  const finishCancelled = pendingResponse();
  const aborting = request(entry, guestToken, cancelledController.signal);
  const abortCheck = assert.rejects(aborting, (error) => cancelled(error) && unknown(error));
  cancelledController.abort(); finishCancelled(entry); await abortCheck;
  assert.deepEqual(read(4, 8), pending);
  for (const code of [201, 401, 409]) {
    reset(); const finish = pendingResponse(); const changing = request(entry, guestToken);
    const check = assert.rejects(changing, (error) => cancelled(error) && unknown(error));
    login(newToken, 5); finish(code === 201 ? entry : { error: "PRIVATE OLD SESSION" }, code); await check;
    assert.equal(session.readSession("guest").token, newToken); assert.equal(session.readSessionNotice("guest"), "");
    assert.deepEqual(read(4, 8), pending, "An old response must not clear a request marker or reveal prior-session data.");
    assert.equal(read(5, 8), null);
  }
  reset();
  const finishRelogin = pendingResponse(); const reloggingIn = request(entry, guestToken);
  const reloginCheck = assert.rejects(reloggingIn, cancelled);
  login(newToken, 4); finishRelogin({ error: "PRIVATE" }, 401); await reloginCheck;
  assert.equal(session.readSession("guest").token, newToken);
  assert.deepEqual(read(4, 8), pending, "A newer sign-in by the same guest also keeps the previous attempt unresolved.");
  reset();
  const finishLogout = pendingResponse(); const loggingOut = request(entry, guestToken);
  const logoutCheck = assert.rejects(loggingOut, cancelled);
  session.clearSession("guest"); finishLogout(entry); await logoutCheck;
  assert.deepEqual(read(4, 8), pending);

  for (const raw of ["not-json", "null", "[]", "{}", JSON.stringify({ ...pending, guestId: 5 }), JSON.stringify({ ...pending, stage: "unknown" }),
    JSON.stringify({ ...pending, quantity: "2" }), JSON.stringify({ ...pending, serviceId: null }),
    JSON.stringify({ ...pending, quantity: null }), JSON.stringify({ ...pending, extra: true })]) {
    reset(); storage.set(key, raw);
    assert.throws(() => read(4, 8), /could not be verified/);
    await assert.rejects(request(entry, guestToken), /could not be verified/); assert.equal(calls.length, 0);
  }
  reset(); rejectReads = true;
  assert.throws(() => read(4, 8), /could not read/); await assert.rejects(request(entry, guestToken), status(401)); assert.equal(calls.length, 0);
  for (const fail of ["reject", "discard"]) {
    reset(); rejectWrites = fail === "reject"; discardWrites = fail === "discard";
    await assert.rejects(request(entry, guestToken), /No request was sent/); assert.equal(calls.length, 0);
  }
  reset(); failSavedWrite = true;
  await assert.rejects(request(entry, guestToken), (error) => error.saved === true && error.status === 201 && !error.outcomeUnknown);
  assert.deepEqual(read(4, 8), pending); assert.equal(calls.length, 1);
  await assert.rejects(request(entry, guestToken), unknown); assert.equal(calls.length, 1);
  rejectRemoval = true; assert.throws(() => clear(4, 8), /could not clear/);
  reset(); rejectRemoval = true; respond = () => response({ error: "PRIVATE" }, 409);
  await assert.rejects(request(entry, guestToken), status(409)); assert.deepEqual(read(4, 8), pending);

  reset(); respond = () => response(catalogue);
  assert.deepEqual(await load(guestToken), [ { ...catalogue[0], UnitPrice: "1500.00" }, catalogue[1] ]);
  assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.body, undefined); assert.match(calls[0].url, /\/services$/);
  for (const change of [
    (rows) => { rows.push({ ...rows[0] }); }, (rows) => { rows[0].ServiceID = 0; },
    (rows) => { rows[0].ServiceName = " "; }, (rows) => { rows[0].Description = {}; },
    (rows) => { rows[0].UnitPrice = "0.001"; }, (rows) => { rows[0].UnitPrice = -1; },
    (rows) => { rows[0].UnitPrice = "100000000.00"; }, (rows) => { rows[0].IsActive = "true"; },
  ]) {
    const rows = structuredClone(catalogue); change(rows); respond = () => response(rows);
    await assert.rejects(load(guestToken), /could not be verified/);
  }
  for (const code of [400, 403, 404, 429, 500]) {
    respond = () => response({ error: "PRIVATE SQL" }, code);
    await assert.rejects(load(guestToken), (error) => error.status === code && !/PRIVATE/.test(error.message));
  }
  for (const code of [200, 401]) {
    reset(); const finish = pendingResponse(); const loading = load(guestToken);
    const check = assert.rejects(loading, cancelled); login(newToken, 5); finish(catalogue, code); await check;
    assert.equal(session.readSession("guest").token, newToken); assert.equal(session.readSessionNotice("guest"), "");
  }
  reset(); respond = () => response({ error: "PRIVATE" }, 401);
  await assert.rejects(load(guestToken), status(401)); assert.equal(session.readSession("guest"), null);
  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(load(guestToken), /catalogue is unavailable/);
  respond = () => ({ status: 200, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(load(guestToken), /could not be verified/);
  const catalogueController = new AbortController();
  const finishCatalogueAbort = pendingResponse(); const catalogueLoading = load(guestToken, catalogueController.signal);
  const catalogueAbortCheck = assert.rejects(catalogueLoading, cancelled);
  catalogueController.abort(); finishCatalogueAbort(catalogue, 200); await catalogueAbortCheck;

  reset();
  const realSetTimeout = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  await assert.rejects(request(entry, guestToken), unknown); assert.deepEqual(read(4, 8), pending); assert.equal(calls.length, 1);
  clear(4, 8);
  respond = () => new Promise((resolve) => realSetTimeout(() => resolve(response(entry, 201)), 10));
  await assert.rejects(request(entry, guestToken), unknown); assert.deepEqual(read(4, 8), pending); assert.equal(calls.length, 2);
  respond = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  await assert.rejects(load(guestToken), /took too long/);
  respond = () => new Promise((resolve) => realSetTimeout(() => resolve(response(catalogue)), 10));
  await assert.rejects(load(guestToken), /took too long/);
  replace("setTimeout", realSetTimeout);

  for (const path of ["/guest/bookings/8/services", "/guest/bookings/2147483647/services"]) {
    assert.deepEqual(intent.guestSignInState(path), { returnTo: path });
    assert.deepEqual(intent.guestReturnDestination({ returnTo: path }), { pathname: path });
  }
  for (const path of ["https://example.com", "//example.com", "/guest/bookings/08/services", "/guest/bookings/0/services", "/guest/bookings/2147483648/services", "/guest/bookings/8/services?x=1", "/guest/bookings/8/services#x", "/guest/bookings/8/services/", "/guest/bookings/8%2f9/services"]) {
    assert.equal(intent.guestSignInState(path), undefined);
    assert.deepEqual(intent.guestReturnDestination({ returnTo: path }), { pathname: "/guest" });
  }
  console.log("PASS: exact service amounts and quantities, validated catalogue, single POST with server-owned identity/price, persisted duplicate guards across reload, definite rejection versus uncertain outcomes, acknowledged saves despite storage failure, safe errors and guest session/abort/timeout protection (actual Vite modules; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
