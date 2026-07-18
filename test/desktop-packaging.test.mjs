import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { planDesktopResources, validateNodeVersion } = await import(
  "../scripts/prepare-desktop-sidecar.mjs"
);
const { reserveLoopbackPort, uiEnvironment } = await import("../desktop/ui-entry.mjs");

test("desktop package plan contains daemon and UI entrypoints", () => {
  const manifest = planDesktopResources({ platform: "darwin", arch: "arm64" });

  assert.deepEqual(manifest.resources, ["daemon/daemon.mjs", "ui/server.js", "runtime/aihr-node"]);
  assert.equal(manifest.binaryName, "aihr-node-aarch64-apple-darwin");
  assert.equal(manifest.runtimeName, "aihr-node");
  assert.equal(manifest.targetTriple, "aarch64-apple-darwin");
});

test("desktop package plan names the Windows sidecar executable", () => {
  const manifest = planDesktopResources({ platform: "win32", arch: "x64" });

  assert.equal(manifest.binaryName, "aihr-node-x86_64-pc-windows-msvc.exe");
  assert.equal(manifest.runtimeName, "aihr-node.exe");
  assert.equal(manifest.targetTriple, "x86_64-pc-windows-msvc");
});

test("desktop runtime validation accepts Node 24 and rejects other majors", () => {
  assert.equal(validateNodeVersion("v24.14.0\n"), 24);
  assert.throws(() => validateNodeVersion("v20.18.0\n"), /Node 24/i);
});

test("packaging script excludes development data and carries daemon native dependencies", () => {
  const script = fs.readFileSync(
    new URL("../scripts/prepare-desktop-sidecar.mjs", import.meta.url),
    "utf8"
  );

  assert.match(script, /rmSync\(path\.join\(uiDir, "data"\)/);
  assert.match(script, /\["better-sqlite3", "bindings", "file-uri-to-path"\]/);
  assert.match(script, /dereference:\s*options\.dereference === true/);
  assert.match(script, /AIHR_SKIP_WEB_BUILD/);
  assert.match(script, /createRequire as __aihrCreateRequire/);
  assert.match(script, /const require = __aihrCreateRequire/);
  assert.match(script, /exposePnpmRuntimeDependencies/);
  assert.match(script, /path\.join\(uiDir, "node_modules"\)/);
});

test("UI launcher reserves loopback only and shares desktop credentials", async () => {
  const reservation = await reserveLoopbackPort();
  try {
    assert.equal(reservation.host, "127.0.0.1");
    assert.ok(reservation.port > 0);
    assert.deepEqual(
      uiEnvironment(
        { dbPath: "/tmp/history.sqlite", token: "paired" },
        { host: reservation.host, port: reservation.port }
      ),
      {
        AIHR_DB_PATH: "/tmp/history.sqlite",
        AIHR_API_TOKEN: "paired",
        HOSTNAME: "127.0.0.1",
        PORT: String(reservation.port)
      }
    );
  } finally {
    await reservation.release();
  }
});

test("desktop workflow builds unsigned installers on native macOS and Windows runners", () => {
  const workflow = fs.readFileSync(
    new URL("../.github/workflows/desktop-build.yml", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version:\s*["']?24["']?/);
  assert.match(workflow, /AIHR_DESKTOP_NODE_BINARY/);
  assert.match(workflow, /npm run desktop:prepare/);
  assert.match(workflow, /tauri build --bundles \$\{\{ matrix\.bundles \}\}/);
  assert.match(workflow, /bundles:\s*dmg/);
  assert.match(workflow, /bundles:\s*["']nsis,msi["']/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /APPLE_(CERTIFICATE|SIGNING)|TAURI_SIGNING|WINDOWS_CERTIFICATE/);
});

test("release readiness checklist covers signing, notarization, Windows signing, and updates", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const script = fs.readFileSync(new URL("../scripts/release-readiness-check.mjs", import.meta.url), "utf8");
  const doc = fs.readFileSync(new URL("../docs/release-readiness.md", import.meta.url), "utf8");
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.equal(pkg.scripts["release:check"], "node scripts/release-readiness-check.mjs");
  for (const token of [
    "APPLE_CERTIFICATE_P12_BASE64",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "WINDOWS_CODESIGN_CERT_PFX_BASE64",
    "WINDOWS_TIMESTAMP_URL",
    "TAURI_SIGNING_PRIVATE_KEY",
    "AIHR_UPDATE_BASE_URL"
  ]) {
    assert.match(script, new RegExp(token));
    assert.match(doc, new RegExp(token));
  }
  assert.match(doc, /Production Release Gates/i);
  assert.match(doc, /Gatekeeper assessment/);
  assert.match(doc, /rollback/i);
  assert.match(readme, /npm run release:check/);
  assert.doesNotMatch(readme, /正式分发所需.*不在当前范围内/);
});

test("Tauri bundle declares product metadata, icons, and packaged resources", () => {
  const config = JSON.parse(
    fs.readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
  );

  assert.equal(config.identifier, "com.aihistoryrecall.desktop");
  assert.equal(config.bundle.active, true);
  assert.equal(config.bundle.category, "Productivity");
  assert.ok(config.bundle.icon.includes("icons/icon.icns"));
  assert.ok(config.bundle.icon.includes("icons/icon.ico"));
  assert.deepEqual(config.bundle.resources, [
    "resources/daemon",
    "resources/ui",
    "resources/extension",
    "resources/runtime"
  ]);
  assert.equal(config.bundle.externalBin, undefined);
});

test("macOS tray icon uses a template image instead of a filled square", () => {
  const tray = fs.readFileSync(new URL("../src-tauri/src/tray.rs", import.meta.url), "utf8");

  assert.match(tray, /\.icon_as_template\(true\)/);
  assert.match(tray, /on_line/);
  assert.doesNotMatch(tray, /x == 6 \|\| x == 25 \|\| y == 5 \|\| y == 26/);
});
