import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("conversation DOM activity schedules a background snapshot without intercepting input", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "extension", "content.js"), "utf8");
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");

  assert.match(content, /MutationObserver/);
  assert.match(content, /AIHR_CONVERSATION_ACTIVITY/);
  assert.match(background, /AIHR_CONVERSATION_ACTIVITY/);
  assert.doesNotMatch(content, /preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/);
  assert.doesNotMatch(background, /chrome\.debugger|Input\.dispatch|dispatchMouse|dispatchKey/);
});

test("extension manifest, scripts, and web bridge advertise the same build", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8")
  );
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");
  const content = fs.readFileSync(path.join(process.cwd(), "extension", "content.js"), "utf8");
  const bridge = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "capture", "useExtensionBridge.ts"),
    "utf8"
  );

  assert.equal(manifest.version, "0.1.43");
  for (const source of [background, content, bridge]) {
    assert.match(source, /0\.1\.43/);
    assert.match(source, /desktop-pairing-20260717/);
  }
});

test("background service worker is self-contained during Chrome registration", () => {
  const entry = fs.readFileSync(path.join(process.cwd(), "extension", "background-entry.js"), "utf8");
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");
  const registration = entry.match(/^importScripts\(([\s\S]*?)\);\s*$/);

  assert.ok(registration);
  assert.deepEqual([...registration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]), [
    "core/constants.js",
    "core/chrome-api.js",
    "core/api-client.js",
    "core/capture-queue.js",
    "core/scheduler.js",
    "background.js"
  ]);
  assert.doesNotMatch(entry, /^\s*(?:import|export)\s/m);
  assert.match(background, /function createIncrementalTracker/);
  assert.match(background, /function nextSnapshotAt/);
});

test("DeepSeek discovery marks the pinned group as outside the recent known streak", () => {
  const adapter = fs.readFileSync(path.join(process.cwd(), "extension", "platforms", "deepseek.js"), "utf8");

  assert.match(adapter, /ignoreKnownStreak/);
  assert.match(adapter, /deepSeekHistorySection/);
});
