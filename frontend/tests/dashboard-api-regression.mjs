// Mocked browser/session/fetch checks against the actual Vite-loaded API module.
// No backend connection or hotel-data writes are performed.
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
function token(id) {
  return `${id}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
function fixture(branchId = "all") {
  const branches = [
    { branchId: 1, branchName: "Colombo", totalRooms: 3, occupiedRooms: 1, availableRooms: 2, maintenanceRooms: 0, occupancyPercentage: 33.33 },
    { branchId: 2, branchName: "Kandy", totalRooms: 1, occupiedRooms: 0, availableRooms: 0, maintenanceRooms: 1, occupancyPercentage: 0 },
  ];
  const rooms = branchId === "all"
    ? { totalRooms: 4, occupiedRooms: 1, availableRooms: 2, maintenanceRooms: 1, currentOccupancyPercentage: 25 }
    : { ...branches.find((branch) => branch.branchId === branchId) };
  if (branchId !== "all") {
    rooms.currentOccupancyPercentage = rooms.occupancyPercentage;
    delete rooms.occupancyPercentage;
    delete rooms.branchId;
    delete rooms.branchName;
  }
  return { date: "2026-10-06", branchId, summary: { ...rooms, todayCheckIns: 3, todayCompletedCheckIns: 1,
    todayCheckOuts: 2, todayCompletedCheckOuts: 1, todayRevenue: "15100.00", todayPaymentsCount: 2, activeBookings: 5 },
  ...(branchId === "all" ? { branchBreakdown: branches } : {}) };
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
  const api = await server.ssrLoadModule("/src/services/dashboardApi.js");
  const auth = await server.ssrLoadModule("/src/services/staffAuth.js");
  await server.close();
  server = null;
  const { loadManagerDashboard: load, validateDashboardResponse: valid, formatDashboardMoney: money,
    formatDashboardDate: date, canViewDashboard } = api;
  const managerToken = token("manager");
  const newToken = token("new-manager");
  function login(role = "Manager", accessToken = managerToken) {
    auth.saveStaffSession({ token: accessToken, staff: { staffId: 1, name: "Test staff", username: "test", role } });
  }
  function reset() { storage.clear(); calls = []; login(); respond = () => response(fixture()); }
  const status = (expected) => (error) => error.status === expected;
  const cancelled = (error) => error.name === "AbortError";

  assert.equal(canViewDashboard("Manager"), true);
  assert.equal(canViewDashboard("Admin"), true);
  for (const role of ["Receptionist", "ServiceStaff", "Guest", undefined]) assert.equal(canViewDashboard(role), false);
  reset();
  for (const scope of [undefined, null, "all", "01", "0", " 1", "1 ", "1.0", "1e1", "1&branchId=2", 2147483648, [], {}]) {
    await assert.rejects(load(scope, managerToken), status(400));
  }
  assert.equal(calls.length, 0, "Invalid filters must not reach fetch.");
  for (const role of ["Receptionist", "ServiceStaff"]) {
    login(role);
    await assert.rejects(load("", managerToken), status(403));
  }
  storage.clear();
  await assert.rejects(load("", managerToken), status(401));
  login();
  await assert.rejects(load("", newToken), status(401));
  assert.equal(calls.length, 0, "Rejected identity/role must not reach fetch.");

  assert.equal(valid(fixture(), ""), true);
  assert.equal(valid(fixture(1), "1"), true);
  assert.equal(valid(fixture(1), 1), true);
  for (const mutate of [
    (data) => { data.date = "2026-02-30"; }, (data) => { data.date = "2026-10-06T00:00:00Z"; },
    (data) => { data.branchId = "1"; }, (data) => { data.summary.totalRooms = "4"; },
    (data) => { data.summary.activeBookings = Number.MAX_SAFE_INTEGER + 1; },
    (data) => { data.summary.todayCheckIns = -1; }, (data) => { data.summary.todayPaymentsCount = 1.5; },
    (data) => { data.summary.todayCompletedCheckIns = 4; }, (data) => { data.summary.todayCompletedCheckOuts = 3; },
    (data) => { data.summary.availableRooms = 3; }, (data) => { data.summary.currentOccupancyPercentage = 25.01; },
    (data) => { data.summary.currentOccupancyPercentage = null; }, (data) => { data.summary.todayRevenue = 15100; },
    (data) => { data.summary.todayRevenue = "15100.001"; }, (data) => { data.summary.todayRevenue = "-1.00"; },
    (data) => { data.branchBreakdown = null; }, (data) => { data.branchBreakdown[1].branchId = 1; },
    (data) => { data.branchBreakdown[0].branchId = "1"; }, (data) => { data.branchBreakdown[0].branchName = null; },
    (data) => { data.branchBreakdown[0].occupancyPercentage = 33.34; },
    // Internal row totals remain valid; chain reconciliation must still catch the mismatch.
    (data) => { data.branchBreakdown[1].totalRooms = 2; data.branchBreakdown[1].maintenanceRooms = 2; },
    (data) => { data.branchBreakdown[1].availableRooms = 1; data.branchBreakdown[1].maintenanceRooms = 0; },
  ]) { const bad = fixture(); mutate(bad); assert.equal(valid(bad, ""), false); }
  assert.equal(valid(null, ""), false);
  assert.equal(valid([], ""), false);
  assert.equal(valid(fixture(1), "2"), false);
  assert.equal(valid({ ...fixture(1), branchBreakdown: [] }, "1"), false);
  const empty = fixture();
  for (const field of ["totalRooms", "occupiedRooms", "availableRooms", "maintenanceRooms"]) empty.summary[field] = 0;
  empty.summary.currentOccupancyPercentage = null;
  empty.branchBreakdown = [];
  assert.equal(valid(empty, ""), true);
  empty.summary.currentOccupancyPercentage = 0;
  assert.equal(valid(empty, ""), false);
  assert.equal(money("9007199254740993.01"), "LKR 9,007,199,254,740,993.01");
  assert.equal(money("0.01"), "LKR 0.01");
  for (const amount of [null, 0, "1e3", "1", "-1.00", "1.001", "NaN"]) assert.equal(money(amount), "Unavailable");
  assert.equal(date("2024-02-29"), "29 February 2024");
  assert.equal(date("2026-02-29"), "Unavailable");

  reset();
  assert.deepEqual(await load("", managerToken), fixture());
  assert.match(calls[0].url, /\/dashboard\/admin$/);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${managerToken}`);
  assert.equal(calls[0].options.cache, "no-store");
  respond = () => response(fixture(1));
  assert.deepEqual(await load("1", managerToken), fixture(1));
  assert.match(calls[1].url, /\/dashboard\/admin\?branchId=1$/);
  respond = () => response({ error: "PRIVATE SQL" });
  await assert.rejects(load("", managerToken), /could not be verified/);
  respond = () => ({ status: 200, ok: true, json: async () => { throw new Error("PRIVATE PARSE"); } });
  await assert.rejects(load("", managerToken), /could not be verified/);
  respond = () => response(fixture(), 202);
  await assert.rejects(load("", managerToken), /could not be verified/);
  for (const code of [403, 404, 429, 500, 502]) {
    respond = () => response({ error: "PRIVATE SQL" }, code);
    await assert.rejects(load("", managerToken), (error) => error.status === code && !error.message.includes("PRIVATE"));
  }
  respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(load("", managerToken), /dashboard service is unavailable/);

  reset();
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(load("", managerToken, alreadyAborted.signal), cancelled);
  assert.equal(calls.length, 0);
  const filterAbort = new AbortController();
  const finishOldFilter = pendingResponse();
  const oldFilter = load("1", managerToken, filterAbort.signal);
  const oldFilterCheck = assert.rejects(oldFilter, cancelled);
  filterAbort.abort();
  respond = () => response(fixture(2));
  assert.deepEqual(await load("2", managerToken), fixture(2));
  finishOldFilter(fixture(1));
  await oldFilterCheck;
  const finishOldSession = pendingResponse();
  const oldSession = load("", managerToken);
  const oldSessionCheck = assert.rejects(oldSession, cancelled);
  login("Admin", newToken);
  finishOldSession({ error: "expired" }, 401);
  await oldSessionCheck;
  assert.equal(auth.readStaffSession().token, newToken, "An old 401 must preserve a newer sign-in.");
  respond = () => response({ error: "PRIVATE AUTH" }, 401);
  await assert.rejects(load("", newToken), status(401));
  assert.equal(auth.readStaffSession(), null);
  assert.match(storage.get("skynest_staff_session_notice"), /expired/);

  reset();
  const realSetTimeout = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
  await assert.rejects(load("", managerToken), /took too long/);
  replace("setTimeout", realSetTimeout);
  assert.equal(auth.readStaffSession().token, managerToken, "A timeout must not sign out the current session.");
  console.log("PASS: dashboard client roles/scopes, strict response and room reconciliation, exact large cash, safe errors, abort/timeout and stale-session protection (actual Vite-loaded module; mocked fetch, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
