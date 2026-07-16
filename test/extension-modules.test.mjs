import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadExtensionScripts(files) {
  const context = vm.createContext({});
  context.globalThis = context;

  for (const file of files) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  return context;
}

function adapter(overrides = {}) {
  return {
    id: "chatgpt",
    matches: (url) => url.includes("chatgpt.com"),
    discover: async () => ({}),
    extract: async () => ({}),
    diagnostics: async () => ({}),
    ...overrides
  };
}

test("constants publish the versioned extension contract", () => {
  const context = loadExtensionScripts(["extension/core/constants.js"]);

  assert.equal(context.AIHR_CONSTANTS.extensionVersion, "0.1.43");
  assert.equal(context.AIHR_CONSTANTS.protocolVersion, 1);
  assert.deepEqual([...context.AIHR_CONSTANTS.endpointCandidates], [
    "http://127.0.0.1:32145",
    "http://127.0.0.1:3000"
  ]);
  assert.equal(Object.isFrozen(context.AIHR_CONSTANTS), true);
});

test("platform registry selects one complete adapter by URL", () => {
  const context = loadExtensionScripts(["extension/platforms/registry.js"]);
  context.AIHR_PLATFORMS.register(adapter());

  assert.equal(context.AIHR_PLATFORMS.forUrl("https://chatgpt.com/c/1").id, "chatgpt");
  assert.equal(context.AIHR_PLATFORMS.forUrl("https://gemini.google.com/app"), null);
});

test("platform registry rejects incomplete and duplicate adapters", () => {
  const context = loadExtensionScripts(["extension/platforms/registry.js"]);

  assert.throws(() => context.AIHR_PLATFORMS.register({ id: "chatgpt", matches: () => true }));

  context.AIHR_PLATFORMS.register(adapter());
  assert.throws(() => context.AIHR_PLATFORMS.register(adapter()));
});

test("bridge protocol accepts known content messages and rejects unknown or incompatible messages", () => {
  const context = loadExtensionScripts(["extension/core/constants.js", "extension/core/protocol.js"]);

  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_WEB_GET_STATUS" }).ok, true);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_CONTENT_PING", protocolVersion: 1 }).ok, true);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "UNKNOWN" }).ok, false);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_WEB_GET_STATUS", protocolVersion: 999 }).ok, false);
});

test("manifest loads content contracts before the existing coordinator", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));

  assert.deepEqual(manifest.content_scripts[0].js, [
    "core/constants.js",
    "core/protocol.js",
    "platforms/registry.js",
    "incremental-sync.js",
    "content.js"
  ]);
  assert.equal(manifest.background.service_worker, "background.js");
});
