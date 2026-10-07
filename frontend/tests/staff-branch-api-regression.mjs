// Exercise the actual Vite-loaded client with independent API fixtures.
// No live backend or hotel writes are used.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const original = Object.fromEntries(["window", "sessionStorage", "fetch", "setTimeout"]
  .map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
const emptyFilters = { bookingId: "", guestName: "", idNumber: "", branchId: "", status: "" };
const branches = [{ BranchID: 17, Name: "Mountain Lodge" }, { BranchID: 29, Name: "Coastal Lodge" }];
const booking = { BookingID: 41, BookingStatus: "Booked", GuestName: "Test Guest", rooms: [
  { RoomID: 91, BranchID: 17, BranchName: "Mountain Lodge", RoomTypeName: "Double", RoomNumber: "201",
    CheckInDate: "2026-10-11", CheckOutDate: "2026-10-12", RoomStatus: "Available" },
] };
let server;
let calls = [];
let respond;
function replace(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) };
}
function token(name) {
  return `${name}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
const currentToken = token("first");
const laterToken = token("later");
function scope(role = "Receptionist", branchId = 17) {
  return { staffId: 23, role, branchId, branchName: branchId === null ? null : "Mountain Lodge" };
}
const status = (code) => (error) => error.status === code;
const cancelled = (error) => error.name === "AbortError";
function pendingResponse() {
  let finish;
  respond = () => new Promise((resolve) => { finish = resolve; });
  return (data, code = 200) => finish(response(data, code));
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return respond(url, options); });
  server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/staffBookingApi.js");
  const auth = await server.ssrLoadModule("/src/services/staffAuth.js");
  await server.close();
  server = null;
  function login(role = "Receptionist", accessToken = currentToken, staffId = 23, branchId = 999) {
    auth.saveStaffSession({ token: accessToken, staff: { staffId, branchId, name: "Test Staff", username: "test", role } });
  }
  function reset(role = "Receptionist", assignedBranch = 17) {
    storage.clear(); calls = []; login(role);
    respond = (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/staff/scope")) return response(scope(role, assignedBranch));
      if (path.endsWith("/branches")) return response(branches);
      if (path.endsWith("/bookings")) return response([booking]);
      throw new Error("Unexpected test path");
    };
  }
  const search = (filters = emptyFilters, accessToken = currentToken, signal) => api.loadStaffBookingSearch(filters, accessToken, signal);
  const safeFailure = (code) => (error) => error.status === code && !error.message.includes("PRIVATE");

  assert.equal(api.isBranchRestricted("Receptionist"), true);
  assert.equal(api.isBranchRestricted("ServiceStaff"), true);
  assert.equal(api.isBranchRestricted("Manager"), false);
  assert.equal(api.isBranchRestricted("Admin"), false);

  for (const role of ["Receptionist", "ServiceStaff"]) {
    reset(role);
    const result = await search({ ...emptyFilters, branchId: "29", status: "Booked", guestName: "Smith & Co" });
    assert.deepEqual(result.scope, scope(role));
    assert.deepEqual(result.branches, []);
    assert.deepEqual(result.bookings, [booking]);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/staff\/scope$/);
    const query = new URL(calls[1].url).searchParams;
    assert.equal(query.get("branchId"), "17", "A supplied foreign branch cannot replace the resolved assignment.");
    assert.equal(query.get("guestName"), "Smith & Co");
    assert.equal(query.get("status"), "Booked");
    assert.equal(auth.readStaffSession().staff.branchId, 999, "Cached profile assignment must not override live scope.");
    for (const call of calls) {
      assert.equal(call.options.method, "GET");
      assert.equal(call.options.headers.Authorization, `Bearer ${currentToken}`);
      assert.equal(call.options.cache, "no-store");
      assert.equal(call.options.body, undefined);
    }
    // A cleared search still reloads scope and uses the assigned branch.
    calls = [];
    await search();
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/staff\/scope$/);
    assert.equal(new URL(calls[1].url).search, "?branchId=17");
  }

  for (const role of ["Manager", "Admin"]) {
    reset(role, null);
    assert.deepEqual((await search()).scope, scope(role, null));
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /\/staff\/scope$/);
    assert.match(calls[1].url, /\/branches$/);
    assert.equal(new URL(calls[2].url).search, "");
    assert.deepEqual((await search({ ...emptyFilters, branchId: "29" })).branches, branches);
    assert.equal(new URL(calls.at(-1).url).search, "?branchId=29");
    reset(role);
    await search();
    assert.equal(new URL(calls.at(-1).url).search, "", "A manager's assigned branch does not remove all-branch access.");
  }

  reset();
  storage.clear();
  await assert.rejects(search(), status(401));
  assert.equal(calls.length, 0);
  login();
  await assert.rejects(search(emptyFilters, laterToken), status(401));
  assert.equal(calls.length, 0);
  login("Receptionist", currentToken, "01");
  await assert.rejects(search(), status(403));
  assert.equal(calls.length, 0);
  login("Receptionist", currentToken, "23");
  assert.equal((await search()).scope.staffId, 23);

  for (const bad of [null, [], "bad", {}, { ...scope(), staffId: "23" }, { ...scope(), staffId: 0 },
    { ...scope(), staffId: 2147483648 }, { ...scope(), role: "Guest" }, { ...scope(), role: "receptionist" },
    { ...scope(), branchId: "17" }, { ...scope(), branchId: 0 }, { ...scope(), branchId: 1.5 },
    { ...scope(), branchId: null, branchName: null }, { ...scope(), branchName: null },
    { ...scope(), branchName: "  " }, { ...scope(), branchId: 2147483648 }]) {
    reset(); respond = () => response(bad);
    await assert.rejects(search(), /could not be verified/);
    assert.equal(calls.length, 1, "Malformed scope must block all downstream queries.");
    assert.equal(auth.readStaffSession().token, currentToken);
  }
  for (const bad of [{ ...scope("Manager", null), branchName: "Unassigned" },
    { ...scope("Manager"), branchName: null }]) {
    reset("Manager"); respond = () => response(bad);
    await assert.rejects(search(), /could not be verified/);
    assert.equal(calls.length, 1);
  }
  for (const changed of [{ ...scope(), staffId: 24 }, scope("Manager")]) {
    reset(); respond = () => response(changed);
    await assert.rejects(search(), status(401));
    assert.equal(calls.length, 1);
    assert.equal(auth.readStaffSession(), null);
  }
  for (const code of [403, 404, 429, 500, 502]) {
    reset(); respond = () => response({ error: "PRIVATE SQL" }, code);
    await assert.rejects(search(), safeFailure(code));
    assert.equal(calls.length, 1);
    assert.equal(auth.readStaffSession().token, currentToken);
  }
  reset(); respond = () => response({ error: "PRIVATE AUTH" }, 401);
  await assert.rejects(search(), safeFailure(401));
  assert.equal(calls.length, 1);
  assert.equal(auth.readStaffSession(), null);
  for (const code of [201, 202, 204]) {
    reset(); respond = () => response(scope(), code);
    await assert.rejects(search(), /could not be verified/);
    assert.equal(calls.length, 1);
  }
  reset(); respond = () => ({ status: 200, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(search(), /could not be verified/);
  assert.equal(calls.length, 1);
  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(search(), (error) => !error.message.includes("PRIVATE"));
  assert.equal(calls.length, 1);

  reset();
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(search(emptyFilters, currentToken, alreadyAborted.signal), cancelled);
  assert.equal(calls.length, 0);
  const changingFilters = new AbortController();
  const finishAborted = pendingResponse();
  const abortedSearch = search(emptyFilters, currentToken, changingFilters.signal);
  const abortedCheck = assert.rejects(abortedSearch, cancelled);
  changingFilters.abort(); finishAborted(scope());
  await abortedCheck;
  assert.equal(calls.length, 1, "Aborted scope must not start a booking request.");

  reset();
  const finishOld = pendingResponse();
  const oldSearch = search();
  const oldCheck = assert.rejects(oldSearch, cancelled);
  login("Manager", laterToken);
  finishOld({ error: "expired" }, 401);
  await oldCheck;
  assert.equal(calls.length, 1);
  assert.equal(auth.readStaffSession().token, laterToken, "An old 401 must preserve a newer login.");

  reset();
  const finishStale = pendingResponse();
  const staleSearch = search();
  const staleCheck = assert.rejects(staleSearch, cancelled);
  login("ServiceStaff", laterToken);
  finishStale(scope());
  await staleCheck;
  assert.equal(calls.length, 1);

  reset();
  const realSetTimeout = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
  await assert.rejects(search(), (error) => error.status === 0);
  assert.equal(calls.length, 1);
  assert.equal(auth.readStaffSession().token, currentToken);
  replace("setTimeout", realSetTimeout);
  console.log("PASS: live-scope-first booking searches, assigned-branch filters including cleared searches, manager scopes, strict responses/identity, safe scope failures, abort/timeout and stale-session protection (Vite-loaded client; mocked fetch, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
