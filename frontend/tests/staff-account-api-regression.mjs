// Actual Vite-loaded client, independent HTTP/storage fixtures; no live account creation.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["window", "sessionStorage", "fetch", "setTimeout"];
const originals = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
const key = "skynest_staff_creation:1";
const token = (label) => `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const adminToken = token("admin");
const otherToken = token("other");
const scope = { staffId: 1, role: "Admin", branchId: null, branchName: null };
const branch = { BranchID: 2, Name: "SkyNest Kandy", Location: "Kandy", ContactNumber: "+94 81 234 5678" };
const draft = { branchId: 2, name: "New Staff", role: "Receptionist", email: "new@example.test", username: "new.staff", password: "  Secret🗝️123  " };
const ack = { staffId: 9, name: "New Staff", role: "Receptionist", username: "new.staff" };
let calls = [];
let handler;
let mode = "normal";
let server;
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function reply(data, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) }; }
function normal(url) {
  if (url.endsWith("/staff/scope")) return reply(scope);
  if (url.endsWith("/branches")) return reply([branch]);
  if (url.endsWith("/auth/staff/register")) return reply(ack, 201);
  throw new Error("Unexpected endpoint");
}
const status = (code) => (error) => error.status === code && !/PRIVATE/.test(error.message);
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const aborted = (error) => error.name === "AbortError";
const posts = () => calls.filter(({ options }) => options.method === "POST");
function deferred(path = "/auth/staff/register") {
  let complete;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  handler = (url) => {
    if (!url.endsWith(path)) return normal(url);
    return new Promise((resolve) => { complete = (data = ack, code = 201) => resolve(reply(data, code)); started(); });
  };
  return { ready, complete: (...args) => complete(...args) };
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (name) => { if (mode === "read-fails" && name.startsWith("skynest_staff_creation:")) throw new Error("PRIVATE storage"); return storage.get(name) ?? null; },
    setItem: (name, value) => {
      if (name.startsWith("skynest_staff_creation:")) {
        if (mode === "write-fails" || (mode === "saved-fails" && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE storage");
        if (mode === "discard-write") return;
      }
      storage.set(name, String(value));
    },
    removeItem: (name) => {
      if (name.startsWith("skynest_staff_creation:") && mode === "remove-fails") throw new Error("PRIVATE storage");
      if (mode !== "discard-remove") storage.delete(name);
    },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return handler(url, options); });
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/staffAccountApi.js");
  const reload = await server.ssrLoadModule("/src/services/staffAccountApi.js?reload=1");
  const sessions = await server.ssrLoadModule("/src/services/session.js");
  await server.close(); server = null;
  const { parseStaffDraft: parse, loadStaffCreation: load, createStaffAccount: create,
    readStaffCreationAttempt: read, clearStaffCreationAttempt: clear, canCreateStaff } = api;
  function login(accessToken = adminToken, role = "Admin", staffId = 1) {
    sessions.saveSession("staff", { token: accessToken, refreshToken: "admin-refresh", staff: { staffId, role, name: "Administrator", username: "administrator" } });
  }
  function reset() {
    mode = "normal"; storage.clear(); calls = []; handler = normal; login();
    clear(1, { confirmedNotCreated: true });
    reload.clearStaffCreationAttempt(1, { confirmedNotCreated: true });
  }

  reset();
  assert.equal(canCreateStaff("Admin"), true);
  for (const role of ["Manager", "Receptionist", "ServiceStaff", "admin", undefined]) assert.equal(canCreateStaff(role), false);
  assert.deepEqual(parse({ ...draft, name: " New Staff ", username: " new.staff ", email: " new@example.test ", branchId: "2", staffId: 123 }), draft);
  for (const role of ["Admin", "Manager"]) assert.equal(parse({ ...draft, role, branchId: "", email: " " }).branchId, null);
  for (const role of ["Receptionist", "ServiceStaff"]) {
    for (const branchId of [undefined, null, ""]) assert.throws(() => parse({ ...draft, role, branchId }), status(400));
  }
  assert.equal(parse({ ...draft, name: "𐐀".repeat(100), username: "𐐀".repeat(60) }).name.length, 200);
  for (const change of [{ name: "" }, { name: "x\n" }, { name: "𐐀".repeat(101) }, { username: " " },
    { username: "x".repeat(61) }, { username: "x\u0000" }, { role: "manager" }, { email: "a@b" }, { email: "a\n@b.test" },
    { email: `${"a".repeat(140)}@example.test` }, { branchId: true }, { branchId: 0 }, { branchId: "01" },
    { branchId: "1e2" }, { branchId: 2147483648 }, { password: "12345" }, { password: "é".repeat(37) }, { password: null }]) {
    assert.throws(() => parse({ ...draft, ...change }), status(400));
  }
  for (const password of ["123456", " ".repeat(6), "é".repeat(36), "😀".repeat(18), " x\npass "]) {
    assert.equal(parse({ ...draft, password }).password, password, "Passwords retain their exact bytes, including whitespace.");
  }
  await assert.rejects(create({ ...draft, password: "short" }, adminToken), status(400)); assert.equal(calls.length, 0);

  for (const role of ["Manager", "Receptionist", "ServiceStaff"]) {
    reset(); login(adminToken, role);
    await assert.rejects(load(adminToken), status(403));
    await assert.rejects(create(draft, adminToken), status(403)); assert.equal(calls.length, 0);
  }
  reset(); await assert.rejects(load(otherToken), status(401)); assert.equal(calls.length, 0);
  for (const value of [null, [], {}, { ...scope, staffId: 2 }, { ...scope, staffId: "1" }, { ...scope, role: "Manager" },
    { ...scope, branchId: 0 }, { ...scope, branchId: 2, branchName: null }]) {
    reset(); handler = () => reply(value);
    await assert.rejects(load(adminToken), status(403)); assert.equal(calls.length, 1);
    await assert.rejects(create(draft, adminToken), status(403)); assert.equal(posts().length, 0); assert.equal(read(1), null);
  }
  reset(); assert.deepEqual(await load(adminToken), { branches: [branch] });
  assert.match(calls[0].url, /\/staff\/scope$/); assert.match(calls[1].url, /\/branches$/);
  for (const { options } of calls) { assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store"); }
  for (const value of [null, {}, [branch, { ...branch, BranchID: "2" }], [{ ...branch, Name: "" }], [{ ...branch, Location: null }], [{ ...branch, ContactNumber: 123 }]]) {
    reset(); handler = (url) => url.endsWith("/branches") ? reply(value) : normal(url);
    await assert.rejects(load(adminToken));
    await assert.rejects(create(draft, adminToken)); assert.equal(posts().length, 0);
  }
  reset(); handler = (url) => url.endsWith("/branches") ? reply([]) : normal(url);
  await assert.rejects(create(draft, adminToken), status(400)); assert.equal(posts().length, 0); assert.equal(read(1), null);

  reset(); const adminSession = storage.get("skynest_staff_session");
  assert.deepEqual(await create(draft, adminToken), ack);
  assert.equal(posts().length, 1); assert.match(posts()[0].url, /\/auth\/staff\/register$/);
  assert.deepEqual(JSON.parse(posts()[0].options.body), draft);
  assert.equal(posts()[0].options.headers.Authorization, `Bearer ${adminToken}`);
  assert.equal(posts()[0].options.headers["Content-Type"], "application/json");
  assert.equal(storage.get("skynest_staff_session"), adminSession, "Creating staff never replaces the administrator's login.");
  assert.deepEqual(read(1), { stage: "saved", username: draft.username, receipt: ack });
  for (const secret of [draft.password, draft.email, adminToken, "admin-refresh", '"password"', '"email"']) assert.equal(storage.get(key).includes(secret), false);
  assert.deepEqual(reload.readStaffCreationAttempt(1), read(1));
  await assert.rejects(reload.createStaffAccount(draft, adminToken), unknown); assert.equal(posts().length, 1);
  clear(1); assert.equal(read(1), null);

  for (const code of [400, 401, 403, 409]) {
    reset(); handler = (url) => url.endsWith("/auth/staff/register") ? reply({ error: "PRIVATE sql password" }, code) : normal(url);
    await assert.rejects(create(draft, adminToken), status(code)); assert.equal(storage.has(key), false); assert.equal(posts().length, 1);
    assert.equal(sessions.readSession("staff") === null, code === 401);
  }
  for (const result of [() => reply({ error: "PRIVATE sql" }, 500), () => reply(ack, 200), () => reply(null, 201),
    () => reply({ ...ack, role: "Admin" }, 201), () => reply({ ...ack, staffId: "9" }, 201),
    () => reply({ ...ack, username: "different" }, 201), () => reply({ ...ack, token: "PRIVATE" }, 201),
    () => ({ status: 201, ok: true, json: async () => { throw new Error("PRIVATE json"); } }),
    () => { throw new Error("PRIVATE network"); }]) {
    reset(); handler = (url) => url.endsWith("/auth/staff/register") ? result() : normal(url);
    await assert.rejects(create(draft, adminToken), unknown);
    assert.deepEqual(read(1), { stage: "pending", username: draft.username });
    assert.deepEqual(reload.readStaffCreationAttempt(1), read(1));
    assert.throws(() => clear(1), unknown);
    await assert.rejects(create(draft, adminToken), unknown); assert.equal(posts().length, 1);
    clear(1, { confirmedNotCreated: true }); assert.equal(read(1), null);
  }
  for (const value of ["{", "null", "{}", JSON.stringify({ stage: "pending", username: draft.username, password: "PRIVATE" }),
    JSON.stringify({ stage: "saved", username: draft.username, receipt: { ...ack, username: "other" } })]) {
    reset(); storage.set(key, value);
    assert.throws(() => read(1), unknown); await assert.rejects(create(draft, adminToken), unknown); assert.equal(posts().length, 0);
  }
  for (const storageMode of ["read-fails", "write-fails", "discard-write"]) {
    reset(); mode = storageMode;
    await assert.rejects(create(draft, adminToken)); assert.equal(posts().length, 0);
  }
  reset(); mode = "saved-fails";
  const saved = await create(draft, adminToken);
  assert.deepEqual({ staffId: saved.staffId, name: saved.name, role: saved.role, username: saved.username }, ack);
  assert.match(saved.storageNotice, /created/); assert.equal(read(1).stage, "saved");
  assert.equal(reload.readStaffCreationAttempt(1).stage, "pending", "A reload remains cautious when only the pre-send marker survived.");
  mode = "read-fails"; assert.equal(read(1).stage, "saved", "Keep the known acknowledgment in memory even when storage becomes unreadable.");
  mode = "normal"; clear(1); assert.equal(read(1), null);
  for (const storageMode of ["remove-fails", "discard-remove"]) {
    reset(); await create(draft, adminToken); mode = storageMode;
    assert.throws(() => clear(1), unknown); assert.equal(read(1).stage, "saved");
  }
  reset(); mode = "remove-fails";
  handler = (url) => url.endsWith("/auth/staff/register") ? reply({ error: "PRIVATE" }, 409) : normal(url);
  await assert.rejects(create(draft, adminToken), status(409)); assert.equal(read(1).stage, "pending");

  reset(); let delayed = deferred("/staff/scope");
  let first = create(draft, adminToken); await delayed.ready;
  await assert.rejects(create(draft, adminToken), unknown); assert.throws(() => clear(1, { confirmedNotCreated: true }), unknown);
  delayed.complete(scope, 200); assert.deepEqual(await first, ack); assert.equal(posts().length, 1);
  reset(); delayed = deferred(); first = create(draft, adminToken); await delayed.ready;
  assert.deepEqual(read(1), { stage: "pending", username: draft.username });
  await assert.rejects(reload.createStaffAccount(draft, adminToken), unknown); assert.equal(posts().length, 1);
  delayed.complete(); await first;

  reset(); const preAbort = new AbortController(); preAbort.abort();
  await assert.rejects(create(draft, adminToken, preAbort.signal), aborted); assert.equal(calls.length, 0);
  reset(); delayed = deferred(); const controller = new AbortController(); first = create(draft, adminToken, controller.signal);
  await delayed.ready; controller.abort(); delayed.complete();
  await assert.rejects(first, (error) => aborted(error) && unknown(error)); assert.equal(read(1).stage, "pending");
  reset(); delayed = deferred(); first = create(draft, adminToken); await delayed.ready;
  login(otherToken); delayed.complete({ error: "PRIVATE expired" }, 401);
  await assert.rejects(first, (error) => aborted(error) && unknown(error));
  assert.equal(sessions.readSession("staff").token, otherToken); assert.equal(read(1).stage, "pending");
  reset(); delayed = deferred("/staff/scope"); first = create(draft, adminToken); await delayed.ready;
  login(otherToken); delayed.complete(scope, 200);
  await assert.rejects(first, aborted); assert.equal(posts().length, 0); assert.equal(read(1), null);

  reset(); replace("setTimeout", (callback, delay) => originals.setTimeout.value(callback, delay === 10000 ? 0 : delay));
  handler = (url, options) => url.endsWith("/auth/staff/register") ? new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("PRIVATE timeout")), { once: true });
  }) : normal(url);
  await assert.rejects(create(draft, adminToken), unknown); assert.equal(posts().length, 1); assert.equal(read(1).stage, "pending");
  replace("setTimeout", originals.setTimeout.value);
  console.log("PASS: Admin-only staff creation, fresh scope/branch checks, exact password bytes, credential-free recovery markers, single POST and reload/concurrency guards, safe unknown outcomes, saved acknowledgments despite storage failure, and stale-session/abort/timeout protection (actual Vite module; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const name of names) {
    if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
    else delete globalThis[name];
  }
}
