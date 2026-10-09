// Actual Vite-loaded frontend, independent HTTP/storage fixtures; no live hotel writes.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["window", "sessionStorage", "fetch", "setTimeout"];
const originals = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
let server;
let calls = [];
let handler;
let storageMode = "normal";
const token = (label) => `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const managerToken = token("manager");
const otherToken = token("other");
const scope = { staffId: 2, role: "Manager", branchId: 1, branchName: "SkyNest Colombo" };
const branch = { BranchID: 3, Name: "SkyNest Galle", Location: "Galle", ContactNumber: "+94 91 234 5678" };
const branchDraft = { name: "SkyNest Galle", location: "Galle", contactNumber: "+94 91 234 5678" };
const roomType = { RoomTypeID: 4, Name: "Garden suite", Capacity: 3, DailyRate: "99999999.99", amenities: ["Wi-Fi", "Balcony"] };
const typeDraft = { name: "Garden suite", capacity: 3, dailyRate: "99999999.99", amenityIds: [1, 2] };
const amenities = [{ AmenityID: 1, AmenityName: "Wi-Fi" }, { AmenityID: 2, AmenityName: "Balcony" }];
const branchAck = { branchId: 3, ...branchDraft };
const typeAck = { roomTypeId: 4, name: "Garden suite", capacity: 3, dailyRate: "99999999.99" };
const branchKey = "skynest_property_attempt:branches:2";
const typeKey = "skynest_property_attempt:room-types:2";
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function reply(data, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) }; }
function normal(url, options) {
  if (url.endsWith("/staff/scope")) return reply(scope);
  if (url.endsWith("/amenities")) return reply(amenities);
  if (url.endsWith("/branches")) return options.method === "POST" ? reply(branchAck, 201) : reply([branch]);
  if (url.endsWith("/room-types")) return options.method === "POST" ? reply(typeAck, 201) : reply([roomType]);
  throw new Error("Unexpected endpoint");
}
const status = (code) => (error) => error.status === code && !/PRIVATE/.test(error.message);
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const aborted = (error) => error.name === "AbortError";
const posts = () => calls.filter(({ options }) => options.method === "POST");
function deferred(path) {
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  handler = (url, options) => {
    if (!url.endsWith(path) || (path !== "/staff/scope" && options.method !== "POST")) return normal(url, options);
    return new Promise((resolve) => { finish = (data, code = 201) => resolve(reply(data, code)); started(); });
  };
  return { ready, finish: (...args) => finish(...args) };
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => { if (storageMode === "read-fails" && key.startsWith("skynest_property_attempt:")) throw new Error("PRIVATE storage"); return storage.get(key) ?? null; },
    setItem: (key, value) => {
      if (key.startsWith("skynest_property_attempt:")) {
        if (storageMode === "write-fails" || (storageMode === "saved-fails" && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE storage");
        if (storageMode === "discard-write") return;
      }
      storage.set(key, String(value));
    },
    removeItem: (key) => { if (storageMode === "remove-fails") throw new Error("PRIVATE storage"); if (storageMode !== "discard-remove") storage.delete(key); },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return handler(url, options); });
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/propertyManagementApi.js");
  const sessions = await server.ssrLoadModule("/src/services/session.js");
  const intents = await server.ssrLoadModule("/src/services/staffIntent.js");
  const { propertyAttemptMatchesCatalogue: matchesCatalogue } = api;
  await server.close(); server = null;
  const { parseBranchDraft: parseBranch, parseRoomTypeDraft: parseType, loadPropertyCatalogue: load,
    createPropertyItem: save, readPropertyAttempt: read, clearPropertyAttempt: clear, canManageProperty } = api;
  function login(accessToken = managerToken, staffId = 2, role = "Manager") {
    sessions.saveSession("staff", { token: accessToken, staff: { staffId, role, name: "Test", username: "test" } });
  }
  function reset() { storageMode = "normal"; storage.clear(); calls = []; handler = normal; login(); }
  function pending(kind, draft) { return { kind, staffId: 2, stage: "pending", id: null, draft }; }

  reset();
  const savedBranch = { kind: "branches", staffId: 2, stage: "saved", id: 3, draft: branchDraft };
  const savedType = { kind: "room-types", staffId: 2, stage: "saved", id: 4, draft: typeDraft };
  const branchCatalogue = { rows: [branch], amenities: [] };
  const typeCatalogue = { rows: [roomType], amenities };
  assert.equal(matchesCatalogue(savedBranch, branchCatalogue), true);
  assert.equal(matchesCatalogue(savedType, typeCatalogue), true);
  assert.equal(matchesCatalogue(savedType, { rows: [{ ...roomType, amenities: ["Balcony", "Wi-Fi"] }], amenities: [...amenities].reverse() }), true);
  for (const receipt of [null, {}, { ...savedBranch, stage: "pending" }, { ...savedBranch, id: null }])
    assert.equal(matchesCatalogue(receipt, branchCatalogue), false, "Only a confirmed saved ID can clear a recovery marker automatically.");
  assert.equal(matchesCatalogue(savedBranch, { rows: [{ ...branch, BranchID: 9 }], amenities: [] }), false);
  assert.equal(matchesCatalogue(savedBranch, { rows: [{ ...branch, ContactNumber: "+94 91 111 1111" }], amenities: [] }), false);
  assert.equal(matchesCatalogue(savedType, { ...typeCatalogue, rows: [{ ...roomType, RoomTypeID: 9 }] }), false);
  assert.equal(matchesCatalogue(savedType, { ...typeCatalogue, rows: [{ ...roomType, DailyRate: "99999999.98" }] }), false);
  for (const names of [["Wi-Fi"], ["Wi-Fi", "Balcony", "Pool"]])
    assert.equal(matchesCatalogue(savedType, { ...typeCatalogue, rows: [{ ...roomType, amenities: names }] }), false);
  assert.equal(matchesCatalogue(savedType, { ...typeCatalogue, amenities: [amenities[0]] }), false, "Selected amenity IDs must still map to their displayed names.");
  for (const path of ["/staff/branches", "/staff/room-types"]) {
    assert.equal(intents.staffReturnDestination({ returnTo: path }), path);
    assert.deepEqual(intents.staffSignInState(path), { returnTo: path });
  }
  for (const path of ["https://outside.example/staff/branches", "//outside.example/staff/room-types", "/staff/branches?next=https://outside.example"])
    assert.equal(intents.staffReturnDestination({ returnTo: path }), "/staff");
  assert.equal(canManageProperty("Manager"), true); assert.equal(canManageProperty("Admin"), true);
  for (const role of ["Receptionist", "ServiceStaff", "Guest", "manager", undefined]) assert.equal(canManageProperty(role), false);
  assert.deepEqual(parseBranch({ ...branchDraft, name: "  SkyNest Galle  " }), branchDraft);
  assert.deepEqual(parseType({ ...typeDraft, capacity: "3", dailyRate: " 0.1 ", amenityIds: ["1", 2] }), { ...typeDraft, dailyRate: "0.10" });
  for (const draft of [null, {}, { ...branchDraft, name: "x\n" }, { ...branchDraft, name: "x".repeat(101) },
    { ...branchDraft, location: " " }, { ...branchDraft, location: "x".repeat(151) },
    ...["123", "1234567890123456", "++94123456789", "94+123456789", "1234abc5678", "9".repeat(21)].map((contactNumber) => ({ ...branchDraft, contactNumber }))]) {
    assert.throws(() => parseBranch(draft), status(400));
  }
  for (const dailyRate of [undefined, null, 3.5, true, "1.001", "1e3", "+1", "01", "-1", "100000000"]) assert.throws(() => parseType({ ...typeDraft, dailyRate }), status(400));
  for (const capacity of [undefined, null, true, "", "01", "1.0", "1e2", 0, -1, 3.5, 101, 2147483648]) assert.throws(() => parseType({ ...typeDraft, capacity }), status(400));
  for (const amenityIds of [undefined, null, {}, [1, "1"], [0], [true], ["01"]]) assert.throws(() => parseType({ ...typeDraft, amenityIds }), status(400));
  assert.deepEqual(parseType({ ...typeDraft, amenityIds: [] }).amenityIds, []);
  await assert.rejects(save("branches", { ...branchDraft, name: " " }, managerToken), status(400));
  await assert.rejects(load("invalid-catalogue", managerToken), status(400)); assert.equal(calls.length, 0);

  for (const role of ["Receptionist", "ServiceStaff"]) {
    reset(); login(managerToken, 2, role);
    await assert.rejects(load("branches", managerToken), status(403));
    await assert.rejects(save("branches", branchDraft, managerToken), status(403)); assert.equal(calls.length, 0);
  }
  reset(); await assert.rejects(load("branches", otherToken), status(401)); assert.equal(calls.length, 0);
  for (const badScope of [null, [], {}, { ...scope, staffId: 3 }, { ...scope, role: "Receptionist" }, { ...scope, branchId: 0 }, { ...scope, branchName: null }]) {
    reset(); handler = () => reply(badScope);
    await assert.rejects(load("branches", managerToken), status(403)); assert.equal(calls.length, 1);
    await assert.rejects(save("branches", branchDraft, managerToken), status(403)); assert.equal(posts().length, 0); assert.equal(read("branches", 2), null);
  }
  reset(); login(managerToken, 2, "Admin"); handler = (url, options) => url.endsWith("/staff/scope") ? reply({ ...scope, role: "Admin", branchId: null, branchName: null }) : normal(url, options);
  assert.deepEqual(await load("branches", managerToken), { rows: [branch], amenities: [] });
  reset(); assert.deepEqual(await load("room-types", managerToken), { rows: [roomType], amenities });
  assert.match(calls[0].url, /\/staff\/scope$/);
  for (const { options } of calls) { assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.redirect, "error"); }
  reset(); handler = (url, options) => url.endsWith("/room-types") ? reply([{ ...roomType, Capacity: 2147483647 }]) : normal(url, options);
  assert.equal((await load("room-types", managerToken)).rows[0].Capacity, 2147483647, "Existing integer capacities remain viewable even above the new-entry UI limit.");
  for (const [kind, rows] of [["branches", [branch, { ...branch, BranchID: "3" }]], ["branches", [{ ...branch, Location: "" }]],
    ["room-types", [{ ...roomType, Capacity: "1e2" }]], ["room-types", [{ ...roomType, DailyRate: "0.001" }]],
    ["room-types", [{ ...roomType, amenities: ["Wi-Fi", "Wi-Fi"] }]], ["room-types", [roomType, roomType]]]) {
    reset(); handler = (url, options) => url.endsWith(`/${kind}`) ? reply(rows) : normal(url, options);
    await assert.rejects(load(kind, managerToken), /could not be verified/);
  }
  reset(); handler = (url, options) => url.endsWith("/amenities") ? reply([amenities[0], amenities[0]]) : normal(url, options);
  await assert.rejects(load("room-types", managerToken), /could not be verified/);
  reset(); handler = (url, options) => url.endsWith("/amenities") ? reply([amenities[0]]) : normal(url, options);
  await assert.rejects(save("room-types", typeDraft, managerToken), status(400)); assert.equal(posts().length, 0);

  for (const [kind, draft, key, savedId] of [["branches", branchDraft, branchKey, 3], ["room-types", typeDraft, typeKey, 4]]) {
    reset(); handler = (url, options) => {
      if (options.method === "POST") assert.deepEqual(read(kind, 2), pending(kind, draft), "A marker must be retained before POST starts.");
      return normal(url, options);
    };
    assert.deepEqual(await save(kind, { ...draft, actorId: 99, password: "not-sent" }, managerToken), { id: savedId, ...draft });
    assert.deepEqual(read(kind, 2), { ...pending(kind, draft), stage: "saved", id: savedId });
    assert.equal(posts().length, 1); const post = posts()[0];
    assert.deepEqual(JSON.parse(post.options.body), draft); assert.equal(post.options.redirect, "error"); assert.equal(post.options.cache, "no-store");
    assert.equal(post.options.headers.Authorization, `Bearer ${managerToken}`); assert.doesNotMatch(storage.get(key), /token|actor|password|signature/);
    await assert.rejects(save(kind, draft, managerToken), unknown); assert.equal(posts().length, 1); clear(kind, 2); assert.equal(read(kind, 2), null);
  }
  reset(); const scopeDelay = deferred("/staff/scope"); const scopedSave = save("branches", branchDraft, managerToken); await scopeDelay.ready;
  await assert.rejects(save("branches", branchDraft, managerToken), unknown); assert.throws(() => clear("branches", 2), /wait/);
  assert.equal(posts().length, 0); scopeDelay.finish(scope, 200); await scopedSave; assert.equal(posts().length, 1);

  for (const code of [400, 401, 403]) {
    reset(); handler = (url, options) => options.method === "POST" ? reply({ error: "PRIVATE SQL" }, code) : normal(url, options);
    await assert.rejects(save("branches", branchDraft, managerToken), (error) => status(code)(error) && error.outcomeUnknown === false);
    assert.equal(storage.has(branchKey), false); assert.equal(posts().length, 1);
    if (code === 401) assert.equal(sessions.readSession("staff"), null);
  }
  for (const code of [200, 202, 204, 301, 404, 409, 500, 504]) {
    reset(); handler = (url, options) => options.method === "POST" ? reply(branchAck, code) : normal(url, options);
    await assert.rejects(save("branches", branchDraft, managerToken), unknown); assert.deepEqual(read("branches", 2), pending("branches", branchDraft));
    await assert.rejects(save("branches", branchDraft, managerToken), unknown); assert.equal(posts().length, 1);
  }
  for (const [kind, draft, data] of [["branches", branchDraft, null], ["branches", branchDraft, { ...branchAck, branchId: 0 }],
    ["branches", branchDraft, { ...branchAck, location: "Another city" }], ["room-types", typeDraft, { ...typeAck, dailyRate: "99999999.98" }],
    ["room-types", typeDraft, { ...typeAck, capacity: 4 }]]) {
    reset(); handler = (url, options) => options.method === "POST" ? reply(data, 201) : normal(url, options);
    await assert.rejects(save(kind, draft, managerToken), unknown); assert.equal(posts().length, 1);
  }
  reset(); handler = (url, options) => { if (options.method === "POST") throw new Error("PRIVATE NETWORK"); return normal(url, options); };
  await assert.rejects(save("branches", branchDraft, managerToken), unknown);
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const reloaded = await server.ssrLoadModule("/src/services/propertyManagementApi.js"); await server.close(); server = null;
  await assert.rejects(reloaded.createPropertyItem("branches", branchDraft, managerToken), unknown); assert.equal(posts().length, 1);

  for (const beforePost of [true, false]) {
    reset(); const controller = new AbortController(); const delayed = deferred(beforePost ? "/staff/scope" : "/branches");
    const saving = save("branches", branchDraft, managerToken, controller.signal); await delayed.ready;
    controller.abort(); delayed.finish(beforePost ? scope : branchAck, beforePost ? 200 : 201);
    await assert.rejects(saving, (error) => aborted(error) && error.outcomeUnknown === !beforePost);
    assert.equal(posts().length, beforePost ? 0 : 1); assert.equal(storage.has(branchKey), !beforePost);
  }
  for (const code of [201, 401]) {
    reset(); const delayed = deferred("/branches"); const saving = save("branches", branchDraft, managerToken); await delayed.ready;
    login(otherToken, 3); delayed.finish(branchAck, code); await assert.rejects(saving, (error) => aborted(error) && unknown(error));
    assert.equal(sessions.readSession("staff").token, otherToken); assert.throws(() => read("branches", 2), status(401));
    assert.throws(() => clear("branches", 2), status(401)); login(); assert.deepEqual(read("branches", 2), pending("branches", branchDraft));
  }
  reset(); const delayedRead = deferred("/staff/scope"); const loading = load("branches", managerToken); await delayedRead.ready;
  login(otherToken, 3); delayedRead.finish(scope, 200); await assert.rejects(loading, aborted); assert.equal(calls.length, 1);

  for (const mode of ["write-fails", "discard-write", "read-fails"]) {
    reset(); storageMode = mode; await assert.rejects(save("branches", branchDraft, managerToken), /browser could not/); assert.equal(posts().length, 0);
  }
  for (const raw of ["{", "null", "{}", JSON.stringify({ ...pending("branches", branchDraft), staffId: 3 }), JSON.stringify({ ...pending("branches", branchDraft), stage: "saved" })]) {
    reset(); storage.set(branchKey, raw); await assert.rejects(save("branches", branchDraft, managerToken), unknown); assert.equal(calls.length, 0);
  }
  reset(); storageMode = "saved-fails";
  const saved = await save("branches", branchDraft, managerToken); assert.equal(saved.id, 3); assert.match(saved.storageNotice, /item was saved/);
  assert.deepEqual(read("branches", 2), pending("branches", branchDraft)); await assert.rejects(save("branches", branchDraft, managerToken), unknown);
  for (const mode of ["remove-fails", "discard-remove"]) { storageMode = mode; assert.throws(() => clear("branches", 2), /could not clear/); }

  reset(); const realTimer = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realTimer(callback, delay === 10000 ? 0 : delay, ...args));
  handler = (url, options) => options.method === "POST" ? new Promise((resolve) => realTimer(() => resolve(reply(branchAck, 201)), 10)) : normal(url, options);
  await assert.rejects(save("branches", branchDraft, managerToken), unknown); assert.equal(posts().length, 1); assert.equal(read("branches", 2).stage, "pending");
  handler = () => new Promise((resolve) => realTimer(() => resolve(reply(scope)), 10));
  await assert.rejects(load("branches", managerToken), /took too long/);
  replace("setTimeout", realTimer);
  console.log("PASS: property client manager scopes, branch/room-type contracts and exact rates, strict drafts and amenity selections, single POSTs, persistent duplicate guards, safe unknown outcomes and saved acknowledgements, storage failures and stale-session/abort/timeout protection (actual Vite module; mocked HTTP/storage, no live backend). ");
} finally {
  if (server) await server.close();
  for (const name of names) { if (originals[name]) Object.defineProperty(globalThis, name, originals[name]); else delete globalThis[name]; }
}
