import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Actual report client, mocked HTTP: no database, accounts or hotel rows changed.
const names = ["window", "sessionStorage", "fetch"];
const originals = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
const storage = new Map();
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
let rows;
let calls = [];
let server;
const base = { ServiceID: 1, ServiceName: "Laundry", BranchID: 1, BranchName: "Colombo",
  BranchScope: "single", TimesUsed: 1, TotalQuantity: 1, TotalRevenue: "100.00" };
const single = { ...base, RoomScope: "single", RoomID: 11, RoomNumber: "101" };
const multiple = { ...base, RoomScope: "multiple", RoomID: null, RoomNumber: "Multiple rooms" };
const unassigned = { ...base, BranchID: null, BranchName: "Unassigned branch", BranchScope: "unassigned",
  RoomScope: "unassigned", RoomID: null, RoomNumber: "Unassigned room" };
const replace = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });

try {
  replace("window", new EventTarget());
  replace("sessionStorage", {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  });
  replace("fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { status: 200, ok: true, json: async () => structuredClone(rows) };
  });
  server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const { loadManagerReport } = await server.ssrLoadModule("/src/services/reportApi.js");
  const { saveSession } = await server.ssrLoadModule("/src/services/session.js");
  saveSession("staff", { token, staff: { staffId: 2, role: "Manager", name: "Test", username: "test" } });
  const load = (filters = {}) => loadManagerReport("service-usage", filters, token);
  rows = [single, multiple, unassigned];
  assert.deepEqual(await load(), rows);
  assert.equal((await load()).reduce((sum, row) => sum + Number(row.TotalRevenue), 0), 300);
  for (const value of [
    [{ ...single, RoomScope: undefined }], [{ ...single, RoomID: null }],
    [{ ...multiple, RoomID: 11 }], [{ ...multiple, RoomNumber: "Room 101" }],
    [{ ...single, BranchScope: "multiple", BranchID: null }],
    [{ ...unassigned, BranchScope: "single", BranchID: 1 }],
    [{ ...single, TotalRevenue: 100 }], [{ ...single, TotalQuantity: -1 }],
    [single, { ...single, RoomID: "11", BranchID: "1", ServiceID: "1" }],
  ]) {
    rows = value;
    await assert.rejects(load(), /could not be verified/);
  }
  rows = [single, multiple];
  assert.deepEqual(await load({ branchId: "1", roomId: "11", serviceId: "1" }), rows);
  assert.equal(calls.at(-1).url.search, "?branchId=1&roomId=11&serviceId=1");
  rows = [{ ...single, BranchID: 2 }];
  await assert.rejects(load({ branchId: "1" }), /could not be verified/);
  rows = [{ ...single, ServiceID: 2 }];
  await assert.rejects(load({ serviceId: "1" }), /could not be verified/);
  rows = [{ ...single, RoomID: 12 }];
  await assert.rejects(load({ roomId: "11" }), /could not be verified/);
  rows = [unassigned];
  await assert.rejects(load({ roomId: "11" }), /could not be verified/);
  const before = calls.length;
  await assert.rejects(load({ roomId: "01" }), (error) => error.status === 400);
  assert.equal(calls.length, before);
  for (const { url, options } of calls) {
    assert.equal(url.pathname, "/api/reports/service-usage");
    assert.ok(options.method === undefined || options.method === "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.cache, "no-store");
  }
  console.log("PASS: service report room/branch groups, exact money, duplicate rejection and filter consistency (actual Vite client; mocked GET-only HTTP).");
} finally {
  if (server) await server.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}