// Real Vite production-build and module-load checks. No browser or backend is used.
// Build output is temporary; the project's dist directory is not changed.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const pages = [
  "Branches", "GuestBill", "GuestLogin", "GuestProfile", "GuestRegister",
  "GuestServices", "MakeBooking", "ManagerDashboard", "ManagerReports", "ManagerServices",
  "MyBookings", "RoomSearch", "ServiceCatalogue", "StaffBilling",
  "StaffBookingDetails", "StaffBookingList", "StaffHome", "StaffLogin",
  "StaffServiceUsage",
];
const previewPages = new Set([
  "GuestBookings", "StaffBookings", "StaffBillDetails", "StaffPayment",
  "ManagerReportsPreview", "ServiceUsagePreview", "DevelopmentPreviews",
]);
const eagerJsBudget = 350_000; // Minified bytes, including every static dependency.
const chunks = new Map();
let temporaryDirectory;
let server;

function modulePath(id) {
  return id.replaceAll("\\", "/").split("?")[0];
}

function staticClosure(manifest, start) {
  const keys = new Set();
  function visit(key) {
    assert.ok(manifest[key], `Manifest dependency is missing: ${key}`);
    if (keys.has(key)) return;
    keys.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  visit(start);
  return keys;
}

function emittedPath(file) {
  const path = resolve(temporaryDirectory, file);
  assert.ok(path.startsWith(`${resolve(temporaryDirectory)}${sep}`),
    `Build asset must remain inside the temporary output: ${file}`);
  return path;
}

try {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "skynest-page-loading-"));
  await build({
    root: frontendRoot,
    mode: "production",
    logLevel: "error",
    plugins: [{
      name: "page-loading-build-evidence",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === "chunk") {
            chunks.set(output.fileName, {
              modules: Object.entries(output.modules).map(([id, info]) => ({
                id: modulePath(id), renderedLength: info.renderedLength,
              })),
            });
          }
        }
      },
    }],
    build: { outDir: temporaryDirectory, emptyOutDir: true, manifest: true },
  });
  const manifest = JSON.parse(await readFile(
    join(temporaryDirectory, ".vite", "manifest.json"), "utf8",
  ));
  assert.equal(manifest["index.html"]?.isEntry, true, "The website entry must exist.");

  const eagerKeys = staticClosure(manifest, "index.html");
  const eagerFiles = new Set([...eagerKeys].map((key) => manifest[key].file));
  const eagerCss = new Set([...eagerKeys].flatMap((key) => manifest[key].css ?? []));
  let eagerBytes = 0;
  for (const file of eagerFiles) {
    assert.ok(chunks.has(file), `Missing JavaScript output: ${file}`);
    eagerBytes += (await stat(emittedPath(file))).size;
  }
  assert.ok(eagerBytes < eagerJsBudget,
    `Initial JavaScript is ${eagerBytes} bytes; budget is below ${eagerJsBudget}.`);

  const emittedCss = new Set();
  for (const item of Object.values(manifest)) {
    for (const key of [...(item.imports ?? []), ...(item.dynamicImports ?? [])]) {
      assert.ok(manifest[key], `Unresolved manifest reference: ${key}`);
    }
    for (const file of [item.file, ...(item.css ?? []), ...(item.assets ?? [])]) {
      assert.ok((await stat(emittedPath(file))).size > 0, `Empty build asset: ${file}`);
    }
    for (const css of item.css ?? []) emittedCss.add(css);
  }
  assert.ok(eagerCss.size > 0, "The shared layout must include its initial styles.");

  for (const page of pages) {
    const source = `src/pages/${page}.jsx`;
    const item = manifest[source];
    assert.equal(item?.isDynamicEntry, true, `${page} must be a dynamic page entry.`);
    assert.ok(!eagerFiles.has(item.file), `${page} must stay outside initial JavaScript.`);
    assert.ok(chunks.get(item.file)?.modules.some(({ id, renderedLength }) =>
      id.endsWith(`/${source}`) && renderedLength > 0), `${page} code must be emitted.`);
    for (const file of eagerFiles) {
      assert.ok(!chunks.get(file).modules.some(({ id, renderedLength }) =>
        id.endsWith(`/${source}`) && renderedLength > 0),
      `${page} must not be duplicated in the initial bundle.`);
    }
    const pageCss = [...staticClosure(manifest, source)]
      .flatMap((key) => manifest[key].css ?? []);
    assert.ok(pageCss.some((file) => !eagerCss.has(file)),
      `${page} must retain a stylesheet loaded with its page bundle.`);
  }

  for (const { modules } of chunks.values()) {
    for (const { id, renderedLength } of modules) {
      const name = id.match(/\/src\/pages\/([^/]+)\.jsx$/)?.[1];
      const isDemo = /\/src\/data\/demo[^/]*\.[jt]sx?$/.test(id);
      if (previewPages.has(name) || isDemo) {
        assert.equal(renderedLength, 0, `Development preview code leaked into production: ${id}`);
      }
    }
  }

  // Loading the actual source modules catches invalid default exports/imports.
  // Components are not rendered, so their effects and hotel requests do not run.
  server = await createServer({
    root: frontendRoot,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  for (const page of pages) {
    const module = await server.ssrLoadModule(`/src/pages/${page}.jsx`);
    assert.equal(typeof module.default, "function", `${page} needs a component default export.`);
  }
  const previews = await server.ssrLoadModule("/src/pages/DevelopmentPreviews.jsx");
  for (const name of [
    "GuestBookingsPreview", "StaffBookingsPreview", "ServiceUsagePreview",
    "StaffBillDetails", "StaffPayment", "ManagerReportsPreview",
  ]) {
    assert.equal(typeof previews[name], "function", `Development preview export is missing: ${name}`);
  }

  console.log(`PASS: actual production build; ${pages.length} live page bundles and their CSS, ` +
    `${eagerBytes.toLocaleString("en-US")} initial JavaScript bytes including static dependencies, ` +
    `${emittedCss.size} emitted stylesheets, excluded preview/demo code and valid live/preview page exports.`);
  console.log("Build/module checks only: browser navigation, rendering, loading failures and live workflows require separate checks.");
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    if (server) await server.close();
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
