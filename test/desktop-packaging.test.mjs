import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { planDesktopResources, validateNodeRuntime } = await import(
  "../scripts/prepare-desktop-sidecar.mjs"
);
const { reserveLoopbackPort, uiEnvironment } = await import("../desktop/ui-entry.mjs");

test("desktop package plan contains daemon and UI entrypoints", () => {
  const manifest = planDesktopResources({ platform: "darwin", arch: "arm64" });

  assert.deepEqual(manifest.resources, ["daemon/daemon.mjs", "ui/server.js"]);
  assert.equal(manifest.binaryName, "aihr-node-aarch64-apple-darwin");
  assert.equal(manifest.targetTriple, "aarch64-apple-darwin");
});

test("desktop package plan names the Windows sidecar executable", () => {
  const manifest = planDesktopResources({ platform: "win32", arch: "x64" });

  assert.equal(manifest.binaryName, "aihr-node-x86_64-pc-windows-msvc.exe");
  assert.equal(manifest.targetTriple, "x86_64-pc-windows-msvc");
});

test("desktop runtime validation rejects the wrong Node major", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-node-runtime-"));
  const fakeNode = path.join(root, "node");
  fs.writeFileSync(fakeNode, "#!/bin/sh\nprintf 'v20.18.0\\n'\n", { mode: 0o755 });

  await assert.rejects(() => validateNodeRuntime(fakeNode), /Node 24/i);
});

test("packaging script excludes development data and carries daemon native dependencies", () => {
  const script = fs.readFileSync(
    new URL("../scripts/prepare-desktop-sidecar.mjs", import.meta.url),
    "utf8"
  );

  assert.match(script, /rmSync\(path\.join\(uiDir, "data"\)/);
  assert.match(script, /\["better-sqlite3", "bindings", "file-uri-to-path"\]/);
  assert.match(script, /createRequire as __aihrCreateRequire/);
  assert.match(script, /const require = __aihrCreateRequire/);
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
