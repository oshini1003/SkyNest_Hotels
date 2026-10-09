// Load actual Vite modules. HTTP and browser storage are independent test doubles;
// these checks do not contact MySQL or create/change hotel bookings.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["window", "sessionStorage", "fetch", "setTimeout"];
const originals = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
let server;
let calls = [];
let respond;
let failWrite = false;
let discardWrite = false;
let failSavedWrite = false;
let failRemoval = false;
const replace = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
const response = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => structuredClone(data) });
const token = (name) => `${name}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const owner = token("owner");
const replacement = token("replacement");
const draft = { bookedRoomId: 19, checkout: "2099-07-05" };
const saved = { bookingId: 8, bookedRoomId: 19, status: "Booked", updated: true };
const markerKey = "skynest_guest_booking_change:4:8";
const unknown = (error) => error.outcomeUnknown === true && !/PRIVATE/.test(error.message);
const status = (expected) => (error) => error.status === expected;
const abort = (error) => error.name === "AbortError";

async function moduleServer() {
  return createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
}

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrite || (failSavedWrite && key === markerKey && JSON.parse(value).kind === "saved")) throw new Error("PRIVATE STORAGE");
      if (!discardWrite) storage.set(key, String(value));
    },
    removeItem: (key) => { if (failRemoval) throw new Error("PRIVATE STORAGE"); storage.delete(key); },
  });
  replace("fetch", async (url, options) => { calls.push({ url, options }); return respond(url, options); });
  server = await moduleServer();
  const api = await server.ssrLoadModule("/src/services/bookingApi.js");
  const session = await server.ssrLoadModule("/src/services/session.js");
  const intent = await server.ssrLoadModule("/src/services/bookingIntent.js");
  await server.close(); server = null;
  const { updateGuestBooking: update, cancelGuestBooking: cancel, readGuestBookingChange: read,
    acknowledgeGuestBookingChange: acknowledge, createGuestBooking: create } = api;
  function login(access = owner, guestId = 4) {
    session.saveSession("guest", { token: access, guest: { guestId, name: "Guest" } });
  }
  function reset() {
    failWrite = false; discardWrite = false; failSavedWrite = false; failRemoval = false;
    login(); acknowledge(8, owner); storage.clear(); login(); calls = []; respond = () => response(saved);
  }
  function pendingResponse() {
    let finish;
    respond = () => new Promise((resolve) => { finish = resolve; });
    return (data = saved, code = 200) => finish(response(data, code));
  }

  reset();
  const single = { roomId: 2, checkin: "2099-07-01", checkout: "2099-07-03", guests: 2, guestId: 99, price: 1 };
  const normalized = { checkin: "2099-07-01", checkout: "2099-07-03", rooms: [{ roomId: 2, guests: 2 }] };
  assert.deepEqual(intent.selectedStay(single), normalized);
  const multi = { ...normalized, rooms: [{ roomId: 2, guests: 2 }, { roomId: 4, guests: 1 }] };
  assert.deepEqual(intent.selectedStay(multi), multi);
  assert.equal(intent.selectedStay({ ...multi, rooms: [...multi.rooms, multi.rooms[0]] }), null);
  assert.equal(intent.selectedStay({ ...multi, rooms: [] }), null);
  assert.equal(intent.selectedStay({ ...multi, rooms: Array.from({ length: 11 }, (_, i) => ({ roomId: i + 1, guests: 1 })) }), null);
  assert.equal(intent.selectedStay({ ...multi, rooms: [{ roomId: 1, guests: 0 }] }), null);
  assert.equal(intent.selectedStay({ ...multi, checkin: "2099-02-30" }), null);
  assert.deepEqual(intent.guestSignInState("/make-booking", { stay: multi }), { returnTo: "/make-booking", stay: multi });
  assert.deepEqual(intent.guestReturnDestination({ returnTo: "/make-booking", stay: multi }), { pathname: "/make-booking", state: { stay: multi } });
  assert.deepEqual(intent.guestSignInState("/make-booking", { stay: multi, bookingSubmitted: true }), { returnTo: "/guest/bookings" });
  assert.deepEqual(intent.guestReturnDestination({ returnTo: "https://example.com", stay: multi }), { pathname: "/guest" });
  for (const path of ["/guest/bookings/8/bill", "/guest/bookings/8/services"]) {
    assert.deepEqual(intent.guestSignInState(path), { returnTo: path });
    assert.deepEqual(intent.guestReturnDestination({ returnTo: path }), { pathname: path });
  }

  // Existing single-room and atomic multi-room create payloads remain compatible.
  for (const details of [
    { roomId: 2, checkin: "2099-07-01", checkout: "2099-07-03", guestCount: 2, paymentMethod: "Cash" },
    { rooms: [{ roomId: 2, guestCount: 2 }, { roomId: 4, guestCount: 1 }], checkin: "2099-07-01", checkout: "2099-07-03", paymentMethod: "Card" },
  ]) {
    reset(); respond = () => response({ bookingId: 8, status: "Booked" }, 201);
    assert.deepEqual(await create(details, owner), { bookingId: 8, status: "Booked" });
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].options.body), details); assert.equal(calls[0].options.redirect, "error");
  }

  reset();
  for (const bad of [0, -1, 1.5, "01", " 8", true, null, [], {}, 2147483648, "8/cancel"]) {
    await assert.rejects(update(bad, draft, owner), status(400));
    await assert.rejects(cancel(bad, owner), status(400));
    await assert.rejects(update(8, { ...draft, bookedRoomId: bad }, owner), status(400));
  }
  for (const bad of [null, [], {}, { bookedRoomId: 19 }, { roomId: 2 }, { ...draft, guestId: 99 }, { ...draft, price: 1 },
    { ...draft, roomId: null }, { ...draft, guestCount: 0 }, { ...draft, checkin: "2099-02-30" },
    { ...draft, checkout: undefined }, { ...draft, checkin: "2099-07-06" }]) {
    await assert.rejects(update(8, bad, owner), status(400));
  }
  assert.equal(calls.length, 0);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(update(8, draft, owner, stopped.signal), abort);
  assert.equal(read(8, owner), null); assert.equal(calls.length, 0);
  await assert.rejects(update(8, draft, replacement), status(401));
  assert.equal(calls.length, 0);

  reset();
  respond = () => {
    assert.equal(read(8, owner).kind, "pending", "Record the attempt before starting fetch.");
    return response(saved);
  };
  assert.deepEqual(await update("8", { bookedRoomId: "19", checkout: "2099-07-05" }, owner), saved);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/bookings\/8$/);
  assert.equal(calls[0].options.method, "PATCH"); assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), draft, "Do not resend omitted dates/guest counts.");
  assert.equal(read(8, owner), null, "A known success releases the guard after verified cleanup.");
  assert.deepEqual(await update(8, draft, owner), saved);
  assert.equal(calls.length, 2, "A separate intentional edit is allowed after confirmed success.");
  respond = () => response({ bookingId: 8, status: "Cancelled" });
  assert.deepEqual(await cancel(8, owner), { bookingId: 8, status: "Cancelled" });
  assert.equal(read(8, owner), null); assert.equal(calls[2].options.body, undefined);

  reset();
  const finish = pendingResponse(); const changing = update(8, draft, owner);
  await assert.rejects(cancel(8, owner), unknown); await assert.rejects(update(8, draft, owner), unknown);
  assert.throws(() => acknowledge(8, owner), /wait for the current/);
  assert.equal(calls.length, 1); finish(); await changing;

  for (const data of [null, [], {}, { ...saved, bookingId: 9 }, { ...saved, bookedRoomId: 20 }, { ...saved, bookedRoomId: "19" },
    { ...saved, status: "Cancelled" }, { ...saved, updated: false }, { bookingId: 8, updated: true }]) {
    reset(); respond = () => response(data);
    await assert.rejects(update(8, draft, owner), unknown); assert.equal(read(8, owner).kind, "unknown");
    await assert.rejects(cancel(8, owner), unknown); assert.equal(calls.length, 1);
  }
  for (const code of [201, 202, 204, 301, 408, 418, 500, 503]) {
    reset(); respond = () => response({ ...saved, error: "PRIVATE SQL" }, code);
    await assert.rejects(update(8, draft, owner), unknown); assert.equal(read(8, owner).kind, "unknown");
  }
  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    reset(); respond = () => response({ error: "PRIVATE SQL" }, code);
    await assert.rejects(update(8, draft, owner), (error) => error.status === code && !error.outcomeUnknown && !/PRIVATE/.test(error.message));
    assert.equal(storage.has(markerKey), false);
    if (code === 401) assert.equal(session.readSession("guest"), null);
  }

  reset(); respond = () => { throw new Error("PRIVATE NETWORK"); };
  await assert.rejects(update(8, draft, owner), unknown); assert.equal(read(8, owner).kind, "unknown");
  server = await moduleServer();
  const reloaded = await server.ssrLoadModule("/src/services/bookingApi.js");
  await server.close(); server = null;
  assert.equal(reloaded.readGuestBookingChange(8, owner).kind, "unknown");
  await assert.rejects(reloaded.cancelGuestBooking(8, owner), unknown); assert.equal(calls.length, 1);
  storage.set(markerKey, JSON.stringify({ guestId: 4, bookingId: 8, kind: "pending", action: "update", bookedRoomId: 19 }));
  assert.equal(reloaded.readGuestBookingChange(8, owner).kind, "unknown", "A reload cannot claim an old request is still pending locally.");

  reset(); const aborting = new AbortController(); const finishAbort = pendingResponse();
  const abortedCall = update(8, draft, owner, aborting.signal);
  const abortCheck = assert.rejects(abortedCall, (error) => abort(error) && unknown(error));
  aborting.abort(); finishAbort(); await abortCheck;
  assert.equal(read(8, owner).kind, "unknown");
  for (const code of [200, 401, 409]) {
    reset(); const finishOld = pendingResponse(); const old = update(8, draft, owner);
    const checkOld = assert.rejects(old, (error) => abort(error) && unknown(error));
    login(replacement, 4); finishOld(saved, code); await checkOld;
    assert.equal(session.readSession("guest").token, replacement);
    assert.equal(read(8, replacement).kind, "unknown");
    await assert.rejects(cancel(8, replacement), unknown); assert.equal(calls.length, 1);
    login(replacement, 5); assert.equal(read(8, replacement), null, "Another guest cannot see the old guest's marker.");
  }

  for (const raw of ["not-json", "null", "[]", "{}", JSON.stringify({ guestId: 5, bookingId: 8, kind: "unknown", action: "cancel" })]) {
    reset(); storage.set(markerKey, raw);
    assert.throws(() => read(8, owner), /could not be verified/);
    await assert.rejects(update(8, draft, owner), /could not be verified/); assert.equal(calls.length, 0);
  }
  for (const mode of ["throw", "discard"]) {
    reset(); failWrite = mode === "throw"; discardWrite = mode === "discard";
    await assert.rejects(update(8, draft, owner), /No request was sent/); assert.equal(calls.length, 0);
  }
  reset(); failRemoval = true;
  assert.deepEqual(await update(8, draft, owner), saved);
  assert.equal(read(8, owner).kind, "saved");
  assert.equal(JSON.parse(storage.get(markerKey)).kind, "saved");
  await assert.rejects(cancel(8, owner), unknown); assert.equal(calls.length, 1);
  reset(); failRemoval = true; failSavedWrite = true;
  assert.deepEqual(await update(8, draft, owner), saved);
  assert.equal(read(8, owner).kind, "saved", "Storage errors cannot turn known success into an uncertain save.");
  assert.equal(JSON.parse(storage.get(markerKey)).kind, "pending");
  await assert.rejects(cancel(8, owner), unknown); assert.equal(calls.length, 1);
  assert.throws(() => acknowledge(8, owner), /could not clear/);

  reset();
  const realTimer = globalThis.setTimeout;
  replace("setTimeout", (callback, delay, ...args) => realTimer(callback, delay === 10000 ? 0 : delay, ...args));
  respond = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  await assert.rejects(update(8, draft, owner), unknown); assert.equal(read(8, owner).kind, "unknown");
  assert.equal(calls.length, 1);
  reset(); respond = () => new Promise((resolve) => realTimer(() => resolve(response(saved)), 10));
  await assert.rejects(update(8, draft, owner), unknown); assert.equal(read(8, owner).kind, "unknown");
  replace("setTimeout", realTimer);
  console.log("PASS: single/multi-room intents and sign-in returns; existing atomic create payloads; strict edit IDs/fields and exact row acknowledgements; shared edit/cancel locks, persistent reconciliation across reload/sign-in, no automatic retries or redirects, safe errors and known saves despite storage failures (actual Vite modules; mocked HTTP/storage, no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
