// Real Vite-loaded catalogue client; independent HTTP/storage doubles, no live hotel writes.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const globalNames = ["window", "sessionStorage", "fetch", "setTimeout"];
const original = Object.fromEntries(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
let server;
let calls = [];
let respond;
let rejectReads = false;
let rejectWrites = false;
let discardWrites = false;
let rejectRemoval = false;
let discardRemoval = false;
let failSavedWrite = false;
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) };
}
function token(label) {
  return `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
const managerToken = token("manager");
const otherToken = token("another-session");
const draft = { serviceId: null, serviceName: "Breakfast Buffet", description: "For one guest", unitPrice: "1500.00" };
const savedRow = { ServiceID: 6, ServiceName: "Breakfast Buffet", Description: "For one guest", UnitPrice: "1500.00", IsActive: true };
const retiredRow = { ServiceID: 7, ServiceName: "Airport Transfer", Description: null, UnitPrice: "99999999.99", IsActive: false };
const catalogue = [savedRow, retiredRow];
const acknowledgement = { saved: true, service: savedRow };
const key = "skynest_service_management_attempt:2";
const pending = { staffId: 2, serviceId: null, serviceName: draft.serviceName, description: draft.description, unitPrice: draft.unitPrice, isActive: true, stage: "pending" };
const status = (expected) => (error) => error.status === expected && !/PRIVATE/.test(error.message);
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const cancelled = (error) => error.name === "AbortError";
const invalidIds = [undefined, true, [], {}, "", "01", " 1", "1 ", "+1", "1e1", "1.0", 0, -1, 1.5, 2147483648, NaN, Infinity, "9".repeat(100)];

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (name) => { if (rejectReads) throw new Error("PRIVATE STORAGE"); return storage.get(name) ?? null; },
    setItem: (name, value) => {
      if (rejectWrites || (failSavedWrite && name.startsWith("skynest_service_management_attempt:") && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE STORAGE");
      if (!discardWrites) storage.set(name, String(value));
    },
    removeItem: (name) => { if (rejectRemoval) throw new Error("PRIVATE STORAGE"); if (!discardRemoval) storage.delete(name); },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return respond(url, options); });
  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/serviceManagementApi.js");
  const session = await server.ssrLoadModule("/src/services/session.js");
  await server.close(); server = null;
  const { canManageServices: allowed, parseServiceDraft: parse, loadManagedServices: load,
    saveManagedService: save, readManagedServiceAttempt: read, clearManagedServiceAttempt: clear } = api;
  function login(accessToken = managerToken, staffId = 2, role = "Manager") {
    session.saveSession("staff", { token: accessToken, staff: { staffId, role, name: "Test manager", username: "test-manager" } });
  }
  function reset() {
    rejectReads = false; rejectWrites = false; rejectRemoval = false; discardWrites = false; discardRemoval = false; failSavedWrite = false;
    storage.clear(); calls = []; login(); respond = () => response(acknowledgement, 201);
  }
  function pendingResponse() {
    let finish;
    respond = () => new Promise((resolve) => { finish = resolve; });
    return (data, code = 201) => finish(response(data, code));
  }

  reset();
  for (const role of ["Manager", "Admin"]) assert.equal(allowed(role), true);
  for (const role of [null, undefined, "manager", "Guest", "Receptionist", "ServiceStaff", "", {}]) assert.equal(allowed(role), false);
  assert.deepEqual(parse({ serviceName: "  Breakfast  ", description: "  Continental  ", unitPrice: " 0.1 " }), {
    serviceName: "Breakfast", description: "Continental", unitPrice: "0.10",
  });
  assert.deepEqual(parse({ serviceName: "💐".repeat(100), description: "💐".repeat(255), unitPrice: "99999999.99" }), {
    serviceName: "💐".repeat(100), description: "💐".repeat(255), unitPrice: "99999999.99",
  });
  for (const empty of [undefined, null, "", "   "]) assert.equal(parse({ ...draft, description: empty }).description, null);
  for (const value of ["0", "19.99", "99999999.99"]) assert.equal(parse({ ...draft, unitPrice: value }).unitPrice, value.includes(".") ? value : "0.00");
  for (const value of [null, undefined, true, 1, [], {}, "", "01.00", "+1", "-1", "1e3", "1.001", "100000000", "9".repeat(100)]) {
    assert.throws(() => parse({ ...draft, unitPrice: value }), status(400));
    await assert.rejects(save({ ...draft, unitPrice: value }, managerToken), status(400));
  }
  for (const value of [null, undefined, true, 1, {}, [], "", "   ", "a".repeat(101), "hello\n", "\tname", "name\u007f", "name\u0085"]) {
    assert.throws(() => parse({ ...draft, serviceName: value }), status(400));
  }
  for (const value of [true, 1, {}, [], "a".repeat(256), "hello\n", "\tdescription", "text\u007f", "text\u0085"]) {
    assert.throws(() => parse({ ...draft, description: value }), status(400));
  }
  for (const serviceId of invalidIds) await assert.rejects(save({ ...draft, serviceId }, managerToken), status(400));
  for (const expected of [null, [], {}, { ...savedRow, ServiceID: 9 }, { ...savedRow, UnitPrice: "0.001" }, { ...savedRow, IsActive: "true" }]) {
    await assert.rejects(save({ ...draft, serviceId: 6, isActive: false, expected }, managerToken), status(400));
  }
  for (const isActive of [null, undefined, 0, 1, "true", "false"]) {
    await assert.rejects(save({ ...draft, serviceId: 6, isActive, expected: savedRow }, managerToken), status(400));
  }
  assert.equal(calls.length, 0);

  for (const role of ["Receptionist", "ServiceStaff"]) {
    reset(); login(managerToken, 2, role);
    await assert.rejects(load(managerToken), status(403));
    await assert.rejects(save(draft, managerToken), status(403)); assert.equal(calls.length, 0);
  }
  reset(); storage.clear(); await assert.rejects(load(managerToken), status(401)); await assert.rejects(save(draft, managerToken), status(401));
  login(); await assert.rejects(save(draft, otherToken), status(401));
  login(managerToken, 0); await assert.rejects(save(draft, managerToken), status(401)); assert.equal(calls.length, 0);
  reset(); const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(load(managerToken, preAborted.signal), cancelled);
  await assert.rejects(save(draft, managerToken, preAborted.signal), cancelled); assert.equal(calls.length, 0); assert.equal(read(2), null);

  reset(); respond = () => {
    assert.deepEqual(read(2), pending, "The readable pending marker must exist before a write is sent.");
    return response(acknowledgement, 201);
  };
  assert.deepEqual(await save({ ...draft, actorId: 99, isActive: false, expected: savedRow }, managerToken), acknowledgement);
  assert.deepEqual(read(2), { ...pending, serviceId: 6, stage: "saved" });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/api\/services$/);
  assert.equal(calls[0].options.method, "POST"); assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error", "Fetch must reject redirects rather than replay a create request to another URL.");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${managerToken}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { serviceName: draft.serviceName, description: draft.description, unitPrice: "1500.00" }, "Create sends exactly three fields; identity and active status remain server-owned.");
  assert.doesNotMatch(storage.get(key), /token|actorId|signature/);
  await assert.rejects(save(draft, managerToken), unknown); assert.equal(calls.length, 1); clear(2); assert.equal(read(2), null);

  reset();
  const originalSnapshot = { ...savedRow, ServiceName: " Legacy name ", Description: " Legacy description ", extra: "not submitted" };
  const edited = { ...draft, serviceId: 6, serviceName: "Edited name", description: "", unitPrice: "19.99", isActive: false, expected: originalSnapshot };
  const editAck = { saved: true, service: { ServiceID: 6, ServiceName: "Edited name", Description: null, UnitPrice: "19.99", IsActive: false } };
  respond = () => response(editAck);
  assert.deepEqual(await save(edited, managerToken), editAck);
  assert.equal(calls[0].options.method, "PUT"); assert.match(calls[0].url, /\/services\/6$/);
  assert.equal(calls[0].options.redirect, "error", "Fetch must reject redirects rather than replay an edit request to another URL.");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    serviceName: "Edited name", description: null, unitPrice: "19.99", isActive: false,
    expected: { ServiceName: " Legacy name ", Description: " Legacy description ", UnitPrice: "1500.00", IsActive: true },
  }, "Optimistic concurrency uses the exact previous text; old IDs and unrelated fields are excluded.");
  assert.equal(read(2).isActive, false); assert.equal(calls.length, 1);

  reset(); const finishConcurrent = pendingResponse(); const first = save(draft, managerToken);
  await assert.rejects(save(draft, managerToken), unknown); assert.throws(() => clear(2), /wait for the current/);
  assert.equal(calls.length, 1); finishConcurrent(acknowledgement); await first; clear(2);

  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    reset(); respond = () => response({ error: "PRIVATE SQL staff account" }, code);
    await assert.rejects(save(draft, managerToken), (error) => status(code)(error) && !error.outcomeUnknown);
    assert.equal(storage.has(key), false); assert.equal(calls.length, 1);
    if (code === 401) { assert.equal(session.readSession("staff"), null); assert.match(session.readSessionNotice("staff"), /expired/); }
  }
  for (const code of [200, 202, 204, 301, 408, 418, 500, 502, 504]) {
    reset(); respond = () => response(acknowledgement, code);
    await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending);
    await assert.rejects(save(draft, managerToken), unknown); assert.equal(calls.length, 1);
  }
  for (const data of [null, [], {}, { ...acknowledgement, saved: false }, { ...acknowledgement, service: null },
    { saved: true, service: { ...savedRow, ServiceID: 0 } }, { saved: true, service: { ...savedRow, ServiceName: "Different" } },
    { saved: true, service: { ...savedRow, Description: null } }, { saved: true, service: { ...savedRow, UnitPrice: "1499.99" } },
    { saved: true, service: { ...savedRow, IsActive: false } }]) {
    reset(); respond = () => response(data, 201);
    await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending);
  }
  reset(); respond = () => response({ saved: true, service: { ...editAck.service, ServiceID: 7 } });
  await assert.rejects(save(edited, managerToken), unknown);
  reset(); respond = () => ({ status: 201, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending);
  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending); assert.equal(calls.length, 1);

  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const reloaded = await server.ssrLoadModule("/src/services/serviceManagementApi.js");
  await server.close(); server = null;
  await assert.rejects(reloaded.saveManagedService(draft, managerToken), unknown);
  assert.deepEqual(reloaded.readManagedServiceAttempt(2), pending); assert.equal(calls.length, 1);

  reset(); const cancelController = new AbortController(); const finishCancelled = pendingResponse();
  const aborting = save(draft, managerToken, cancelController.signal);
  const abortCheck = assert.rejects(aborting, (error) => cancelled(error) && unknown(error));
  cancelController.abort(); finishCancelled(acknowledgement); await abortCheck; assert.deepEqual(read(2), pending);
  for (const code of [201, 401, 409]) {
    for (const nextId of [2, 3]) {
      reset(); const finish = pendingResponse(); const changing = save(draft, managerToken);
      const check = assert.rejects(changing, (error) => cancelled(error) && unknown(error));
      login(otherToken, nextId); finish(code === 201 ? acknowledgement : { error: "PRIVATE" }, code); await check;
      assert.equal(session.readSession("staff").token, otherToken); assert.equal(session.readSessionNotice("staff"), "");
      assert.deepEqual(read(2), pending, "A stale response cannot erase an unresolved action or log out a new session.");
    }
  }
  reset(); const finishLogout = pendingResponse(); const loggingOut = save(draft, managerToken);
  const logoutCheck = assert.rejects(loggingOut, cancelled); session.clearSession("staff"); finishLogout(acknowledgement); await logoutCheck;
  assert.deepEqual(read(2), pending);

  for (const raw of ["not-json", "null", "[]", "{}", JSON.stringify({ ...pending, staffId: 3 }), JSON.stringify({ ...pending, stage: "unknown" }),
    JSON.stringify({ ...pending, serviceId: "6" }), JSON.stringify({ ...pending, unitPrice: "15.000" }),
    JSON.stringify({ ...pending, stage: "saved" }), JSON.stringify({ ...pending, isActive: 1 }), JSON.stringify({ ...pending, extra: true })]) {
    reset(); storage.set(key, raw); assert.throws(() => read(2), /could not be verified/);
    await assert.rejects(save(draft, managerToken), /could not be verified/); assert.equal(calls.length, 0);
  }
  reset(); rejectReads = true; assert.throws(() => read(2), /could not read/);
  await assert.rejects(save(draft, managerToken), status(401)); assert.equal(calls.length, 0);
  for (const kind of ["reject", "discard"]) {
    reset(); rejectWrites = kind === "reject"; discardWrites = kind === "discard";
    await assert.rejects(save(draft, managerToken), /No request was sent/); assert.equal(calls.length, 0);
  }
  reset(); failSavedWrite = true;
  const storedFailureAck = await save(draft, managerToken);
  assert.equal(storedFailureAck.saved, true); assert.deepEqual(storedFailureAck.service, savedRow);
  assert.match(storedFailureAck.storageNotice, /service was saved/i); assert.doesNotMatch(storedFailureAck.storageNotice, /PRIVATE/);
  assert.deepEqual(read(2), pending); await assert.rejects(save(draft, managerToken), unknown); assert.equal(calls.length, 1);
  for (const kind of ["reject", "discard"]) {
    rejectRemoval = kind === "reject"; discardRemoval = kind === "discard";
    assert.throws(() => clear(2), /could not clear/); assert.deepEqual(read(2), pending);
  }
  reset(); rejectRemoval = true; respond = () => response({ error: "PRIVATE" }, 409);
  await assert.rejects(save(draft, managerToken), status(409)); assert.deepEqual(read(2), pending);

  reset(); respond = () => response([{ ...savedRow, ServiceID: "6", UnitPrice: 1500, IsActive: 1 }, { ...retiredRow, IsActive: 0 }]);
  assert.deepEqual(await load(managerToken), catalogue, "Both active and retired records appear, normalized without changing old text.");
  assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.body, undefined); assert.match(calls[0].url, /\/management\/services$/);
  assert.equal(calls[0].options.redirect, "error", "Catalogue reads cannot silently follow a redirect to a different endpoint.");
  respond = () => response([]); assert.deepEqual(await load(managerToken), []);
  for (const change of [
    (rows) => { rows.push({ ...rows[0], ServiceID: "6" }); }, (rows) => { rows[0].ServiceID = 0; },
    (rows) => { rows[0].ServiceName = " "; }, (rows) => { rows[0].ServiceName = "Name\n"; },
    (rows) => { rows[0].Description = {}; }, (rows) => { rows[0].Description = "a".repeat(256); },
    (rows) => { rows[0].UnitPrice = "0.001"; }, (rows) => { rows[0].UnitPrice = -1; },
    (rows) => { rows[0].UnitPrice = "100000000.00"; }, (rows) => { rows[0].IsActive = "true"; },
  ]) {
    const rows = structuredClone(catalogue); change(rows); respond = () => response(rows);
    await assert.rejects(load(managerToken), /could not be verified/);
  }
  for (const code of [201, 204, 400, 403, 404, 429, 500]) {
    respond = () => response({ error: "PRIVATE SQL" }, code); await assert.rejects(load(managerToken), status(code));
  }
  for (const code of [200, 401]) {
    reset(); const finish = pendingResponse(); const loading = load(managerToken);
    const check = assert.rejects(loading, cancelled); login(otherToken, 3); finish(catalogue, code); await check;
    assert.equal(session.readSession("staff").token, otherToken); assert.equal(session.readSessionNotice("staff"), "");
  }
  reset(); respond = () => response({ error: "PRIVATE" }, 401);
  await assert.rejects(load(managerToken), status(401)); assert.equal(session.readSession("staff"), null);
  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(load(managerToken), /could not be loaded/);
  respond = () => ({ status: 200, ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await assert.rejects(load(managerToken), /could not be verified/);
  const loadController = new AbortController(); const finishLoadAbort = pendingResponse(); const loading = load(managerToken, loadController.signal);
  const loadAbortCheck = assert.rejects(loading, cancelled); loadController.abort(); finishLoadAbort(catalogue, 200); await loadAbortCheck;

  reset(); const realSetTimeout = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending); assert.equal(calls.length, 1); clear(2);
  respond = () => new Promise((resolve) => realSetTimeout(() => resolve(response(acknowledgement, 201)), 10));
  await assert.rejects(save(draft, managerToken), unknown); assert.deepEqual(read(2), pending); assert.equal(calls.length, 2);
  respond = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  await assert.rejects(load(managerToken), /took too long/);
  respond = () => new Promise((resolve) => realSetTimeout(() => resolve(response(catalogue)), 10));
  await assert.rejects(load(managerToken), /took too long/); replace("setTimeout", realSetTimeout);

  console.log("PASS: manager/admin catalogue access, exact decimals and strict drafts, active/retired response validation, optimistic edit snapshots, single writes, persisted reconciliation across reload, concurrent guards, known acknowledgements despite storage failures, safe errors and stale-session/abort/timeout handling (actual Vite module; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
