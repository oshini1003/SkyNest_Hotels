// Exercise the actual Vite-loaded client with independent HTTP/storage fixtures; no live hotel writes.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const globals = ["window", "sessionStorage", "fetch", "setTimeout"];
const originals = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
const token = (label) => `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const managerToken = token("manager");
const otherToken = token("other");
const scope = { staffId: 2, role: "Manager", branchId: 1, branchName: "SkyNest Colombo" };
const branch = { BranchID: 5, Name: "SkyNest Kandy", Location: "Kandy", ContactNumber: "+94 81 222 3333" };
const type = { RoomTypeID: 6, Name: "Hill suite", Capacity: 4, DailyRate: "99999999.99", amenities: ["Wi-Fi"] };
const amenity = { AmenityID: 8, AmenityName: "Wi-Fi" };
const room = { RoomID: 71, RoomNumber: "A-101", RoomStatus: "Occupied", BranchID: 5, BranchName: branch.Name,
  RoomTypeID: 6, RoomTypeName: type.Name, Capacity: 4, DailyRate: "99999999.99" };
const roomDraft = { branchId: 5, roomTypeId: 6, roomNumber: "A-101" };
const amenityDraft = { name: "Wi-Fi" };
const roomAck = { roomId: 71, ...roomDraft };
const amenityAck = { amenityId: 8, ...amenityDraft };
let server;
let calls = [];
let handler;
let storageMode = "normal";
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function reply(value, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(value) }; }
function normal(url, options) {
  if (url.endsWith("/staff/scope")) return reply(scope);
  if (url.endsWith("/branches")) return reply([branch]);
  if (url.endsWith("/room-types")) return reply([type]);
  if (url.endsWith("/rooms")) return options.method === "POST" ? reply(roomAck, 201) : reply([room]);
  if (url.endsWith("/amenities")) return options.method === "POST" ? reply(amenityAck, 201) : reply([amenity]);
  throw new Error("Unexpected endpoint");
}
const status = (code) => (error) => error.status === code && !/PRIVATE/.test(error.message);
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const aborted = (error) => error.name === "AbortError";
const posts = () => calls.filter(({ options }) => options.method === "POST");
const keyFor = (kind) => `skynest_property_attempt:${kind}:2`;
const pending = (kind, draft) => ({ kind, staffId: 2, stage: "pending", id: null, draft });
const saved = (kind, draft, id) => ({ ...pending(kind, draft), stage: "saved", id });
function defer(path, method = "POST") {
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  handler = (url, options) => {
    if (!url.endsWith(path) || options.method !== method) return normal(url, options);
    return new Promise((resolve) => { finish = (value, code = 201) => resolve(reply(value, code)); started(); });
  };
  return { ready, finish: (...args) => finish(...args) };
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => {
      if (key.startsWith("skynest_property_attempt:") && storageMode === "read-fails") throw new Error("PRIVATE storage");
      return storage.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (key.startsWith("skynest_property_attempt:")) {
        if (storageMode === "write-fails" || (storageMode === "saved-fails" && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE storage");
        if (storageMode === "discard-write") return;
      }
      storage.set(key, String(value));
    },
    removeItem: (key) => { if (storageMode === "remove-fails") throw new Error("PRIVATE storage"); storage.delete(key); },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return handler(url, options); });
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/propertyManagementApi.js");
  const sessions = await server.ssrLoadModule("/src/services/session.js");
  const intents = await server.ssrLoadModule("/src/services/staffIntent.js");
  const { parseRoomDraft: parseRoom, parseAmenityDraft: parseAmenity, loadPropertyCatalogue: load, createPropertyItem: create,
    readPropertyAttempt: read, clearPropertyAttempt: clear, propertyAttemptMatchesCatalogue: matches } = api;
  await server.close(); server = null;
  function login(accessToken = managerToken, staffId = 2, role = "Manager") {
    sessions.saveSession("staff", { token: accessToken, staff: { staffId, role, name: "Test", username: "test" } });
  }
  function reset() { storageMode = "normal"; storage.clear(); calls = []; handler = normal; login(); }

  reset();
  assert.deepEqual(parseRoom({ branchId: "5", roomTypeId: "6", roomNumber: "  A-101  ", roomStatus: "Occupied", actorId: 3 }), roomDraft);
  assert.deepEqual(parseAmenity({ name: "  Wi-Fi  ", staffId: 3 }), amenityDraft);
  assert.equal(parseRoom({ ...roomDraft, roomNumber: "ආ".repeat(10) }).roomNumber.length, 10);
  assert.equal(parseAmenity({ name: "🛏".repeat(100) }).name, "🛏".repeat(100));
  for (const draft of [null, {}, { ...roomDraft, roomNumber: " " }, { ...roomDraft, roomNumber: "1\n" },
    { ...roomDraft, roomNumber: "x".repeat(11) }, { ...roomDraft, roomNumber: 101 }]) assert.throws(() => parseRoom(draft), status(400));
  for (const field of ["branchId", "roomTypeId"]) for (const value of [null, true, "", "01", "1.0", "1e2", 0, -1, 1.5, 2147483648])
    assert.throws(() => parseRoom({ ...roomDraft, [field]: value }), status(400));
  for (const draft of [null, {}, { name: " " }, { name: "Wi\nFi" }, { name: "x".repeat(101) }, { name: 42 }]) assert.throws(() => parseAmenity(draft), status(400));
  for (const path of ["/staff/rooms", "/staff/amenities"]) {
    assert.equal(intents.staffReturnDestination({ returnTo: path }), path);
    assert.deepEqual(intents.staffSignInState(path), { returnTo: path });
  }
  assert.equal(intents.staffReturnDestination({ returnTo: "https://outside.example/staff/rooms" }), "/staff");
  await assert.rejects(create("rooms", { ...roomDraft, roomNumber: "" }, managerToken), status(400)); assert.equal(calls.length, 0);

  for (const kind of ["rooms", "amenities"]) {
    for (const role of ["Receptionist", "ServiceStaff"]) {
      reset(); login(managerToken, 2, role);
      await assert.rejects(load(kind, managerToken), status(403)); assert.equal(calls.length, 0);
    }
    reset(); await assert.rejects(load(kind, otherToken), status(401)); assert.equal(calls.length, 0);
    reset(); handler = () => reply({ ...scope, role: "Receptionist" });
    await assert.rejects(load(kind, managerToken), status(403)); assert.equal(calls.length, 1);
    reset(); handler = () => reply({ error: "PRIVATE SQL" }, 401);
    await assert.rejects(load(kind, managerToken), status(401)); assert.equal(sessions.readSession("staff"), null);
  }
  reset(); const roomCatalogue = await load("rooms", managerToken);
  assert.deepEqual(roomCatalogue, { rows: [room], branches: [branch], roomTypes: [type], amenities: [] });
  assert.equal(roomCatalogue.rows[0].RoomStatus, "Occupied", "An occupied room is a catalogue row, not a promise of date availability.");
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), ["/api/staff/scope", "/api/rooms", "/api/branches", "/api/room-types"]);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).search, ""); assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.redirect, "error");
  }
  reset(); const amenityCatalogue = await load("amenities", managerToken);
  assert.deepEqual(amenityCatalogue, { rows: [amenity], roomTypes: [type], amenities: [amenity], branches: [] });
  reset(); handler = (url, options) => url.endsWith("/rooms") ? reply([]) : normal(url, options);
  assert.deepEqual((await load("rooms", managerToken)).rows, []);
  reset(); handler = (url, options) => url.endsWith("/rooms") ? reply([{ ...room, RoomID: "71", BranchID: "5", RoomTypeID: "6", Capacity: "4" }]) : normal(url, options);
  assert.deepEqual((await load("rooms", managerToken)).rows, [room]);
  for (const value of [null, {}, [room, { ...room, RoomID: "71" }],
    ...[{ RoomStatus: "Maintenance" }, { RoomStatus: "available" }, { RoomStatus: null }, { RoomNumber: "" }, { RoomNumber: "x".repeat(11) },
      { BranchID: "1e2" }, { RoomTypeID: 0 }, { Capacity: 1.5 }, { DailyRate: "99999999.999" }, { BranchName: "PRIVATE\n" },
      { BranchID: 99 }, { BranchName: "Another branch" }, { RoomTypeID: 99 }, { RoomTypeName: "Another type" },
      { Capacity: 5 }, { DailyRate: "99999999.98" }].map((change) => [{ ...room, ...change }])]) {
    reset(); handler = (url, options) => url.endsWith("/rooms") ? reply(value) : normal(url, options);
    await assert.rejects(load("rooms", managerToken), /could not be verified/);
  }
  for (const value of [null, [amenity, { ...amenity, AmenityID: "8" }], [{ ...amenity, AmenityName: "" }], [{ ...amenity, AmenityName: "x".repeat(101) }]]) {
    reset(); handler = (url, options) => url.endsWith("/amenities") ? reply(value) : normal(url, options);
    await assert.rejects(load("amenities", managerToken), /could not be verified/);
  }
  for (const path of ["/branches", "/room-types"]) {
    reset(); handler = (url, options) => url.endsWith(path) ? reply([]) : normal(url, options);
    await assert.rejects(create("rooms", roomDraft, managerToken), status(400)); assert.equal(posts().length, 0); assert.equal(read("rooms", 2), null);
  }

  for (const [kind, draft, id] of [["rooms", roomDraft, 71], ["amenities", amenityDraft, 8]]) {
    reset(); handler = (url, options) => {
      if (options.method === "POST") assert.deepEqual(read(kind, 2), pending(kind, draft));
      return normal(url, options);
    };
    assert.deepEqual(await create(kind, { ...draft, roomStatus: "Occupied", actorId: 99 }, managerToken), { id, ...draft });
    assert.deepEqual(read(kind, 2), saved(kind, draft, id)); assert.equal(posts().length, 1);
    assert.deepEqual(JSON.parse(posts()[0].options.body), draft); assert.equal(posts()[0].options.headers.Authorization, `Bearer ${managerToken}`);
    assert.doesNotMatch(storage.get(keyFor(kind)), /token|actor|roomStatus|signature/);
    assert.match(calls[0].url, /\/staff\/scope$/);
    if (kind === "rooms") assert.deepEqual(calls.slice(1, -1).map(({ url }) => new URL(url).pathname).sort(), ["/api/branches", "/api/room-types"]);
    await assert.rejects(create(kind, draft, managerToken), unknown); assert.equal(posts().length, 1);
    clear(kind, 2); assert.equal(read(kind, 2), null);
    for (const code of [400, 401, 403, 409]) {
      reset(); handler = (url, options) => options.method === "POST" ? reply({ error: "PRIVATE SQL" }, code) : normal(url, options);
      await assert.rejects(create(kind, draft, managerToken), (error) => status(code)(error) && error.outcomeUnknown === false);
      assert.equal(storage.has(keyFor(kind)), false); assert.equal(posts().length, 1);
    }
    for (const code of [200, 202, 301, 404, 500, 504]) {
      reset(); handler = (url, options) => options.method === "POST" ? reply({ error: "PRIVATE SQL" }, code) : normal(url, options);
      await assert.rejects(create(kind, draft, managerToken), unknown); assert.deepEqual(read(kind, 2), pending(kind, draft));
      await assert.rejects(create(kind, draft, managerToken), unknown); assert.equal(posts().length, 1);
    }
    for (const mode of ["read-fails", "write-fails", "discard-write"]) {
      reset(); storageMode = mode; await assert.rejects(create(kind, draft, managerToken), /browser could not/); assert.equal(posts().length, 0);
    }
    reset(); storageMode = "saved-fails";
    const receipt = await create(kind, draft, managerToken); assert.equal(receipt.id, id); assert.match(receipt.storageNotice, /item was saved/);
    assert.deepEqual(read(kind, 2), pending(kind, draft)); await assert.rejects(create(kind, draft, managerToken), unknown); assert.equal(posts().length, 1);
  }
  for (const [kind, draft, receipt] of [["rooms", roomDraft, { ...roomAck, branchId: 99 }], ["rooms", roomDraft, { ...roomAck, roomTypeId: 99 }],
    ["rooms", roomDraft, { ...roomAck, roomNumber: "Other" }], ["rooms", roomDraft, { ...roomAck, roomId: 0 }],
    ["amenities", amenityDraft, { ...amenityAck, name: "Other" }], ["amenities", amenityDraft, { ...amenityAck, amenityId: null }]]) {
    reset(); handler = (url, options) => options.method === "POST" ? reply(receipt, 201) : normal(url, options);
    await assert.rejects(create(kind, draft, managerToken), unknown); assert.equal(read(kind, 2).stage, "pending");
  }
  assert.equal(matches(saved("rooms", roomDraft, 71), roomCatalogue), true);
  assert.equal(matches(saved("amenities", amenityDraft, 8), amenityCatalogue), true);
  for (const attempt of [pending("rooms", roomDraft), saved("rooms", roomDraft, 72), saved("rooms", { ...roomDraft, branchId: 99 }, 71),
    saved("rooms", { ...roomDraft, roomTypeId: 99 }, 71), saved("rooms", { ...roomDraft, roomNumber: "Other" }, 71)]) assert.equal(matches(attempt, roomCatalogue), false);
  assert.equal(matches(saved("amenities", { name: "Other" }, 8), amenityCatalogue), false);
  assert.equal(matches(saved("amenities", amenityDraft, 9), amenityCatalogue), false);

  reset(); const selectionsDelay = defer("/room-types", "GET"); const first = create("rooms", roomDraft, managerToken); await selectionsDelay.ready;
  await assert.rejects(create("rooms", roomDraft, managerToken), unknown); assert.throws(() => clear("rooms", 2), /wait/);
  assert.equal(posts().length, 0); selectionsDelay.finish([type], 200); await first; assert.equal(posts().length, 1);
  reset(); handler = (url, options) => { if (options.method === "POST") throw new Error("PRIVATE network"); return normal(url, options); };
  await assert.rejects(create("rooms", roomDraft, managerToken), unknown);
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const reloaded = await server.ssrLoadModule("/src/services/propertyManagementApi.js"); await server.close(); server = null;
  await assert.rejects(reloaded.createPropertyItem("rooms", roomDraft, managerToken), unknown); assert.equal(posts().length, 1);
  for (const beforePost of [true, false]) {
    reset(); const controller = new AbortController(); const delayed = defer(beforePost ? "/branches" : "/rooms", beforePost ? "GET" : "POST");
    const creating = create("rooms", roomDraft, managerToken, controller.signal); await delayed.ready;
    controller.abort(); delayed.finish(beforePost ? [branch] : roomAck, beforePost ? 200 : 201);
    await assert.rejects(creating, (error) => aborted(error) && error.outcomeUnknown === !beforePost);
    assert.equal(posts().length, beforePost ? 0 : 1); assert.equal(storage.has(keyFor("rooms")), !beforePost);
  }
  reset(); const delayedRead = defer("/rooms", "GET"); const reading = load("rooms", managerToken); await delayedRead.ready;
  login(otherToken, 3); delayedRead.finish([room], 200); await assert.rejects(reading, aborted);
  reset(); const delayedPost = defer("/amenities"); const creating = create("amenities", amenityDraft, managerToken); await delayedPost.ready;
  login(otherToken, 3); delayedPost.finish({ error: "PRIVATE" }, 401); await assert.rejects(creating, (error) => aborted(error) && unknown(error));
  assert.equal(sessions.readSession("staff").token, otherToken); assert.throws(() => clear("amenities", 2), status(401));
  login(); assert.deepEqual(read("amenities", 2), pending("amenities", amenityDraft));
  reset(); storageMode = "remove-fails"; handler = (url, options) => options.method === "POST" ? reply({}, 409) : normal(url, options);
  await assert.rejects(create("rooms", roomDraft, managerToken), status(409));
  await assert.rejects(create("rooms", roomDraft, managerToken), unknown); assert.equal(posts().length, 1);
  reset(); const realTimer = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realTimer(callback, delay === 10000 ? 0 : delay, ...args));
  handler = (url, options) => options.method === "POST" ? new Promise((resolve) => realTimer(() => resolve(reply(amenityAck, 201)), 10)) : normal(url, options);
  await assert.rejects(create("amenities", amenityDraft, managerToken), unknown); assert.equal(posts().length, 1);
  replace("setTimeout", realTimer);
  console.log("PASS: rooms/amenities catalogue contracts, exact rates and references, scope-first access, current creation selections, duplicate rejections, single protected POSTs, saved acknowledgements and reload/abort/session/timeout guards (actual Vite module; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const name of globals) { if (originals[name]) Object.defineProperty(globalThis, name, originals[name]); else delete globalThis[name]; }
}
