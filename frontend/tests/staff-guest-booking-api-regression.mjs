// Independent HTTP/storage fixtures exercise the actual Vite module; no live hotel writes.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const globals = ["window", "sessionStorage", "fetch", "setTimeout"];
const originals = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const token = (label) => `${label}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const staffToken = token("reception");
const otherToken = token("other");
const scope = { staffId: 3, role: "Receptionist", branchId: 1, branchName: "SkyNest Colombo" };
const branches = [{ BranchID: 1, Name: "SkyNest Colombo" }, { BranchID: 2, Name: "SkyNest Kandy" }];
const types = [{ RoomTypeID: 2, Name: "Double" }];
const room = { RoomID: 4, RoomNumber: "101", RoomStatus: "Available", BranchID: 1, BranchName: "SkyNest Colombo", RoomTypeID: 2, RoomTypeName: "Double", Capacity: 3, DailyRate: "8500.50" };
const room2 = { ...room, RoomID: 5, RoomNumber: "102" };
const draft = { name: "New Guest", contactNumber: "+94771234567", email: "guest@example.test", idNumber: "N1234567", address: "10 Main Street" };
const guest = { GuestID: 9, Name: draft.name, ContactNumber: draft.contactNumber, Email: draft.email, IDNumber: draft.idNumber };
const minimalGuest = { GuestID: 9, Name: draft.name, ContactNumber: draft.contactNumber };
const stay = { checkin: "2098-06-10", checkout: "2098-06-12", rooms: [{ roomId: 4, guests: 2 }] };
const booking = { guestId: 9, roomId: 4, checkin: stay.checkin, checkout: stay.checkout, guestCount: 2, paymentMethod: "Cash" };
const markerKey = "skynest_guest_creation:3";
const storage = new Map();
let liveScope = scope;
let calls = [];
let handler;
let storageMode = "normal";
let server;
function replace(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function reply(data, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) }; }
function normal(url, options = {}) {
  const path = new URL(url, "http://test");
  if (path.pathname.endsWith("/staff/scope")) return reply(liveScope);
  if (path.pathname.endsWith("/branches")) return reply(branches);
  if (path.pathname.endsWith("/room-types")) return reply(types);
  if (path.pathname.endsWith("/rooms")) {
    const rows = [room, room2].filter((row) =>
      (!path.searchParams.has("roomId") || String(row.RoomID) === path.searchParams.get("roomId")) &&
      (!path.searchParams.has("branchId") || String(row.BranchID) === path.searchParams.get("branchId")));
    return reply(rows);
  }
  if (path.pathname.endsWith("/guests")) return options.method === "POST" ? reply({ guest }, 201) : reply([guest]);
  if (path.pathname.endsWith("/bookings")) {
    const body = JSON.parse(options.body);
    return reply({ bookingId: 25, status: "Booked", ...(body.rooms ? { rooms: body.rooms.length } : {}) }, 201);
  }
  throw new Error("Unexpected endpoint");
}
const posts = () => calls.filter(({ options }) => options.method === "POST");
const known = (code) => (error) => error.status === code && error.outcomeUnknown !== true && !/PRIVATE/.test(error.message);
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const aborted = (error) => error.name === "AbortError";
function deferred(suffix) {
  let complete;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  handler = (url, options) => url.endsWith(suffix) ? new Promise((resolve) => {
    complete = (data, status = 200) => resolve(reply(data, status)); started();
  }) : normal(url, options);
  return { ready, complete: (...args) => complete(...args) };
}
try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => { if (key === markerKey && storageMode === "read-fails") throw new Error("PRIVATE storage"); return storage.get(key) ?? null; },
    setItem: (key, value) => {
      if (key === markerKey) {
        if (storageMode === "write-fails" || (storageMode === "saved-fails" && JSON.parse(value).stage === "saved")) throw new Error("PRIVATE storage");
        if (storageMode === "discard-write") return;
      }
      storage.set(key, String(value));
    },
    removeItem: (key) => {
      if (key === markerKey && storageMode === "remove-fails") throw new Error("PRIVATE storage");
      if (key !== markerKey || storageMode !== "discard-remove") storage.delete(key);
    },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return handler(url, options); });
  server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const api = await server.ssrLoadModule("/src/services/staffGuestBookingApi.js");
  const reload = await server.ssrLoadModule("/src/services/staffGuestBookingApi.js?reload=1");
  const sessions = await server.ssrLoadModule("/src/services/session.js");
  await server.close(); server = null;
  const { parseGuestDraft: parse, createGuest: create, searchGuests: search, readGuestCreationAttempt: read, clearGuestCreationAttempt: clear,
    loadFrontDeskScope, loadStaffRoomOptions, searchStaffRooms, loadStaffBookingAvailability, createStaffBooking } = api;
  function login(accessToken = staffToken, role = "Receptionist", staffId = 3) {
    sessions.saveSession("staff", { token: accessToken, refreshToken: "staff-refresh", staff: { staffId, role, name: "Staff", username: "staff", branchId: 99 } });
  }
  function reset() {
    storageMode = "normal"; storage.clear(); calls = []; handler = normal; liveScope = scope; login();
    clear(3, { confirmedNotCreated: true }); reload.clearGuestCreationAttempt(3, { confirmedNotCreated: true });
  }

  reset();
  assert.deepEqual(parse({ ...draft, name: " New Guest ", contactNumber: " +94 77-1234567 ", extra: "ignored" }), draft);
  assert.equal(parse({ ...draft, name: "𐐀".repeat(100), idNumber: "𐐀".repeat(30) }).idNumber.length, 60);
  assert.equal(parse({ ...draft, email: " ", address: " " }).email, null);
  for (const changes of [{ name: "" }, { name: "x".repeat(101) }, { name: "A\nB" }, { contactNumber: "12345" }, { contactNumber: true },
    { contactNumber: "1".repeat(16) }, { email: "bad@email" }, { email: `${"x".repeat(150)}@a.test` }, { address: "x".repeat(256) },
    { idNumber: "" }, { idNumber: " " }, { idNumber: null }, { idNumber: undefined }, { idNumber: 123 }, { idNumber: "x".repeat(31) }]) {
    await assert.rejects(create({ ...draft, ...changes }, staffToken), known(400));
  }
  assert.equal(calls.length, 0, "Invalid guest identity never reaches HTTP.");
  for (const term of ["", "x", "x".repeat(101), "ab\n", 123]) await assert.rejects(search(term, staffToken), known(400));
  assert.equal(calls.length, 0);

  reset(); login(staffToken, "ServiceStaff");
  for (const work of [() => loadFrontDeskScope(staffToken), () => loadStaffRoomOptions(staffToken), () => search("New", staffToken), () => create(draft, staffToken), () => createStaffBooking(booking, staffToken)]) await assert.rejects(work(), known(403));
  assert.equal(calls.length, 0);
  reset(); const choices = await loadStaffRoomOptions(staffToken);
  assert.deepEqual(choices.branches, [{ id: 1, name: "SkyNest Colombo" }]); assert.deepEqual(choices.roomTypes, [{ id: 2, name: "Double" }]);
  assert.deepEqual(choices.scope, scope); assert.match(calls[0].url, /\/staff\/scope$/);
  reset(); const results = await searchStaffRooms({ branchId: "2", roomTypeId: "2", checkin: stay.checkin, checkout: stay.checkout, guests: "2" }, staffToken);
  assert.equal(results.rooms.length, 2); assert.equal(results.rooms[0].pricePerNight, 8500.5);
  const query = new URL(calls[1].url, "http://test").searchParams;
  assert.equal(query.get("branchId"), "1", "Live assigned branch overrides stale cached/profile/form branch.");
  assert.equal(query.get("guestCount"), "2");
  for (const { options } of calls.slice(1)) { assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, `Bearer ${staffToken}`); }
  for (const role of ["Manager", "Admin"]) {
    reset(); login(staffToken, role); liveScope = { staffId: 3, role, branchId: null, branchName: null };
    assert.equal((await loadStaffRoomOptions(staffToken)).branches.length, 2);
    calls = []; await searchStaffRooms({ checkin: stay.checkin, checkout: stay.checkout, guests: 1 }, staffToken);
    assert.equal(new URL(calls[1].url, "http://test").searchParams.has("branchId"), false);
  }
  for (const row of [{ ...room, BranchID: 2 }, { ...room, RoomID: 0 }, { ...room, Capacity: 1 }, { ...room, DailyRate: "1e3" },
    { ...room, DailyRate: null }, { ...room, DailyRate: "8500.505" }, { ...room, RoomStatus: "Maintenance" }, { ...room, RoomTypeName: null }]) {
    reset(); handler = (url, options) => url.includes("/rooms?") ? reply([row]) : normal(url, options);
    await assert.rejects(searchStaffRooms({ checkin: stay.checkin, checkout: stay.checkout, guests: 2 }, staffToken));
  }
  reset(); assert.equal((await loadStaffBookingAvailability(stay, staffToken)).unavailable, 0);
  assert.equal((await loadStaffBookingAvailability(stay, staffToken)).rooms[0].guests, 2);
  reset(); handler = (url, options) => url.includes("/rooms?") ? reply([]) : normal(url, options);
  assert.equal((await loadStaffBookingAvailability(stay, staffToken)).unavailable, 1);
  await assert.rejects(createStaffBooking(booking, staffToken), known(409)); assert.equal(posts().length, 0);

  reset(); assert.deepEqual(await search(" New Guest ", staffToken), [guest]); assert.match(calls[0].url, /\/staff\/scope$/);
  assert.equal(new URL(calls[1].url, "http://test").searchParams.get("q"), "New Guest");
  for (const data of [null, {}, [{ ...guest, GuestID: "9" }], [{ ...guest, GuestID: 2147483648 }], [{ ...guest, Name: 123 }], [{ ...guest, Email: {} }], [guest, guest]]) {
    reset(); handler = (url, options) => url.includes("/guests?") ? reply(data) : normal(url, options);
    await assert.rejects(search("New", staffToken));
  }
  reset(); handler = (url, options) => url.includes("/guests") ? reply({ error: "PRIVATE SQL" }, 404) : normal(url, options);
  await assert.rejects(search("New", staffToken), (error) => known(404)(error) && /not available on this server yet/.test(error.message));
  await assert.rejects(create(draft, staffToken), known(404)); assert.equal(storage.has(markerKey), false);

  reset(); const previousLogin = storage.get("skynest_staff_session");
  assert.deepEqual(await create(draft, staffToken), guest); assert.equal(posts().length, 1);
  assert.deepEqual(JSON.parse(posts()[0].options.body), draft);
  assert.equal(storage.get("skynest_staff_session"), previousLogin);
  assert.deepEqual(read(3), { stage: "saved", guest: minimalGuest }); assert.deepEqual(reload.readGuestCreationAttempt(3), read(3));
  for (const secret of [draft.idNumber, draft.email, draft.address, staffToken, '"idNumber"', '"email"', '"address"']) assert.equal(storage.get(markerKey).includes(secret), false);
  await assert.rejects(create(draft, staffToken), unknown); assert.equal(posts().length, 1); clear(3); assert.equal(read(3), null);
  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    reset(); handler = (url, options) => url.endsWith("/guests") ? reply({ error: "PRIVATE" }, code) : normal(url, options);
    await assert.rejects(create(draft, staffToken), known(code)); assert.equal(posts().length, 1); assert.equal(storage.has(markerKey), false);
    assert.equal(sessions.readSession("staff") === null, code === 401);
  }
  for (const result of [() => reply({ error: "PRIVATE" }, 500), () => reply({ guest }, 200), () => reply({ guest: { ...guest, GuestID: "9" } }, 201),
    () => reply({ guest: { ...guest, Name: "Different Guest" } }, 201), () => reply(null, 201), () => { throw new Error("PRIVATE network"); }]) {
    reset(); handler = (url, options) => url.endsWith("/guests") ? result() : normal(url, options);
    await assert.rejects(create(draft, staffToken), unknown); assert.deepEqual(read(3), { stage: "pending" });
    assert.deepEqual(reload.readGuestCreationAttempt(3), { stage: "pending" });
    assert.throws(() => clear(3), unknown); await assert.rejects(reload.createGuest(draft, staffToken), unknown); assert.equal(posts().length, 1);
    clear(3, { confirmedNotCreated: true }); assert.equal(read(3), null);
  }
  for (const mode of ["read-fails", "write-fails", "discard-write"]) {
    reset(); storageMode = mode; await assert.rejects(create(draft, staffToken)); assert.equal(posts().length, 0);
  }
  reset(); storageMode = "saved-fails";
  assert.deepEqual(await create(draft, staffToken), guest); assert.equal(read(3).stage, "saved"); assert.equal(reload.readGuestCreationAttempt(3).stage, "pending");
  storageMode = "read-fails"; assert.equal(read(3).stage, "saved");
  for (const mode of ["remove-fails", "discard-remove"]) { storageMode = mode; assert.throws(() => clear(3), unknown); assert.equal(read(3).stage, "saved"); }
  for (const raw of ["{", "null", "{}", JSON.stringify({ stage: "pending", idNumber: "PRIVATE" }), JSON.stringify({ stage: "saved", guest })]) {
    reset(); storage.set(markerKey, raw); assert.throws(() => read(3), unknown); await assert.rejects(create(draft, staffToken), unknown); assert.equal(posts().length, 0);
  }

  reset(); let delayed = deferred("/staff/scope"); let first = create(draft, staffToken); await delayed.ready;
  await assert.rejects(create(draft, staffToken), unknown); assert.throws(() => clear(3, { confirmedNotCreated: true }), unknown);
  delayed.complete(scope); await first; assert.equal(posts().length, 1);
  reset(); delayed = deferred("/guests"); first = create(draft, staffToken); await delayed.ready;
  await assert.rejects(reload.createGuest(draft, staffToken), unknown); delayed.complete({ guest }, 201); await first; assert.equal(posts().length, 1);
  reset(); const preAbort = new AbortController(); preAbort.abort(); await assert.rejects(create(draft, staffToken, preAbort.signal), (error) => aborted(error) && !error.outcomeUnknown); assert.equal(calls.length, 0);
  reset(); delayed = deferred("/guests"); const controller = new AbortController(); first = create(draft, staffToken, controller.signal); await delayed.ready;
  controller.abort(); delayed.complete({ guest }, 201); await assert.rejects(first, (error) => aborted(error) && unknown(error)); assert.equal(read(3).stage, "pending");
  reset(); delayed = deferred("/guests"); first = create(draft, staffToken); await delayed.ready;
  login(otherToken); delayed.complete({ error: "PRIVATE" }, 401); await assert.rejects(first, (error) => aborted(error) && unknown(error)); assert.equal(sessions.readSession("staff").token, otherToken);
  reset(); delayed = deferred("/staff/scope"); first = create(draft, staffToken); await delayed.ready;
  login(otherToken); delayed.complete(scope); await assert.rejects(first, aborted); assert.equal(posts().length, 0); assert.equal(read(3), null);

  reset(); assert.deepEqual(await createStaffBooking(booking, staffToken), { bookingId: 25, status: "Booked" });
  assert.deepEqual(JSON.parse(posts()[0].options.body), booking); assert.match(calls[0].url, /\/staff\/scope$/); assert.equal(posts().length, 1);
  const multi = { guestId: 9, checkin: stay.checkin, checkout: stay.checkout, paymentMethod: "Card", rooms: [{ roomId: 4, guestCount: 2 }, { roomId: 5, guestCount: 1 }] };
  reset(); await createStaffBooking(multi, staffToken); assert.deepEqual(JSON.parse(posts()[0].options.body), multi); assert.equal(posts().length, 1);
  for (const body of [{ ...booking, guestId: true }, { ...booking, guestId: "01" }, { ...booking, staffId: 99 }, { ...booking, guestCount: 0 },
    { ...booking, checkout: stay.checkin }, { ...booking, paymentMethod: "Other" }, { ...multi, rooms: [] }, { ...multi, rooms: [multi.rooms[0], multi.rooms[0]] }, { ...multi, roomId: 4 }]) {
    reset(); await assert.rejects(createStaffBooking(body, staffToken), known(400)); assert.equal(calls.length, 0);
  }
  reset(); delayed = deferred("/staff/scope"); first = createStaffBooking(booking, staffToken); await delayed.ready;
  await assert.rejects(createStaffBooking(booking, staffToken), unknown); delayed.complete(scope); await first; assert.equal(posts().length, 1);
  reset(); handler = (url, options) => url.endsWith("/bookings") ? reply({ bookingId: 25, status: "Booked", rooms: 1 }, 201) : normal(url, options);
  await assert.rejects(createStaffBooking(multi, staffToken), unknown); assert.equal(posts().length, 1);
  reset(); handler = (url, options) => url.endsWith("/staff/scope") ? reply({ error: "PRIVATE scope" }, 403) : normal(url, options);
  await assert.rejects(createStaffBooking(booking, staffToken), known(403)); assert.equal(posts().length, 0);

  reset(); replace("setTimeout", (callback, delay) => originals.setTimeout.value(callback, delay === 10000 ? 0 : delay));
  handler = (url, options) => url.endsWith("/guests") ? new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("PRIVATE timeout")), { once: true });
  }) : normal(url, options);
  await assert.rejects(create(draft, staffToken), unknown); assert.equal(posts().length, 1); assert.equal(read(3).stage, "pending");
  replace("setTimeout", originals.setTimeout.value);
  console.log("PASS: receptionist live branch scope, manager access, strict guest identity and room responses, safe guest search, protected walk-in creation and recovery, exact single/multi-room booking payloads, fresh availability before one POST, and stale-session/abort/timeout guards (actual Vite modules; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const name of globals) { if (originals[name]) Object.defineProperty(globalThis, name, originals[name]); else delete globalThis[name]; }
}
