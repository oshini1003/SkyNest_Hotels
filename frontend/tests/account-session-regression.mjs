// Actual Vite-loaded password/session services with mocked browser storage and HTTP.
// No backend connection, password changes or database writes are performed.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const globals = ["window", "sessionStorage", "fetch"];
const original = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const storage = new Map();
const calls = [];
let server;
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
const success = { message: "Password changed successfully. Please sign in again." };

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  });
  replace("fetch", async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  });
  server = await createServer({ root: frontendRoot, configFile: false, logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const passwords = await server.ssrLoadModule("/src/services/passwordApi.js");
  const sessions = await server.ssrLoadModule("/src/services/session.js");
  await server.close();
  server = null;

  const guestToken = token("guest-original");
  const newGuestToken = token("guest-new");
  const staffToken = token("staff-original");
  const newStaffToken = token("staff-new");
  function login(kind, accessToken) {
    sessions.saveSession(kind, { token: accessToken,
      [kind]: kind === "guest" ? { guestId: 1, name: "Guest" } : { staffId: 3, name: "Staff", role: "Receptionist" } });
  }
  function reset() {
    storage.clear();
    calls.length = 0;
    respond = () => response(success);
    login("guest", guestToken);
    login("staff", staffToken);
  }
  function pendingResponse() {
    let finish;
    respond = () => new Promise((resolve) => { finish = resolve; });
    return (data, status = 200) => finish(response(data, status));
  }

  reset();
  assert.deepEqual(await passwords.changeGuestPassword("old-password", "new-password"), success);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/guest\/password$/);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${guestToken}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { currentPassword: "old-password", newPassword: "new-password" });
  assert.equal(sessions.readSession("guest"), null);
  assert.match(sessions.readSessionNotice("guest"), /Password changed/);
  assert.equal(sessions.readSession("staff").token, staffToken, "Guest password change must preserve the staff session.");

  reset();
  respond = () => response({ error: "Current password is incorrect." }, 400);
  await assert.rejects(passwords.changeGuestPassword("wrong-password", "new-password"), /Current password is incorrect/);
  assert.equal(sessions.readSession("guest").token, guestToken);
  assert.equal(sessions.readSessionNotice("guest"), "");
  respond = () => { throw new Error("Network unavailable"); };
  await assert.rejects(passwords.changeGuestPassword("old-password", "new-password"), /service is unavailable/);
  assert.equal(sessions.readSession("guest").token, guestToken);

  reset();
  const finishOldGuest = pendingResponse();
  const oldGuestChange = passwords.changeGuestPassword("old-password", "new-password");
  login("guest", newGuestToken);
  finishOldGuest(success);
  await oldGuestChange;
  assert.equal(sessions.readSession("guest").token, newGuestToken, "Old successful password response must preserve a newer guest sign-in.");
  assert.equal(sessions.readSessionNotice("guest"), "");
  assert.equal(sessions.readSession("staff").token, staffToken);

  reset();
  const finishSignedOut = pendingResponse();
  const signedOutChange = passwords.changeGuestPassword("old-password", "new-password");
  sessions.clearSession("guest");
  finishSignedOut(success);
  await signedOutChange;
  assert.equal(sessions.readSession("guest"), null);
  assert.equal(sessions.readSessionNotice("guest"), "", "Old response must not replace a later intentional sign-out notice.");

  reset();
  await passwords.changeStaffPassword("old-password", "new-password");
  assert.match(calls[0].url, /\/auth\/staff\/password$/);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${staffToken}`);
  assert.equal(sessions.readSession("staff"), null);
  assert.match(sessions.readSessionNotice("staff"), /Password changed/);
  assert.equal(sessions.readSession("guest").token, guestToken, "Staff password change must preserve the guest session.");

  reset();
  const finishOldStaff = pendingResponse();
  const oldStaffChange = passwords.changeStaffPassword("old-password", "new-password");
  login("staff", newStaffToken);
  finishOldStaff(success);
  await oldStaffChange;
  assert.equal(sessions.readSession("staff").token, newStaffToken);
  assert.equal(sessions.readSessionNotice("staff"), "");
  assert.equal(sessions.readSession("guest").token, guestToken);

  console.log("PASS: actual password/session services; authenticated request contracts, successful sign-out, validation/network failures, delayed success preserves newer guest/staff sessions, explicit sign-out and independent guest/staff storage (mock HTTP; no live backend).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
