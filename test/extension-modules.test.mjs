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

function loadContentBridge() {
  const eventHandlers = new Map();
  const sentMessages = [];
  const window = {
    addEventListener(type, handler) {
      eventHandlers.set(type, handler);
    },
    postMessage() {}
  };
  const context = vm.createContext({
    URL,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sentMessages.push(message);
          callback({ ok: true });
        },
        onMessage: { addListener() {} }
      }
    },
    crypto: { randomUUID: () => "request-id" },
    document: { body: {}, title: "" },
    location: { href: "http://127.0.0.1:3000/capture", origin: "http://127.0.0.1:3000" },
    window
  });
  context.globalThis = context;

  for (const file of ["extension/core/constants.js", "extension/core/protocol.js", "extension/content.js"]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  return {
    dispatch(message) {
      eventHandlers.get("message")({
        source: window,
        origin: context.location.origin,
        data: { source: "aihr-web", ...message }
      });
    },
    sentMessages
  };
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

  assert.equal(context.AIHR_CONSTANTS.extensionVersion, "0.1.44");
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

test("platform registry continues after an adapter match failure", () => {
  const context = loadExtensionScripts(["extension/platforms/registry.js"]);
  context.AIHR_PLATFORMS.register(adapter({ id: "broken", matches: () => { throw new Error("unavailable"); } }));
  context.AIHR_PLATFORMS.register(adapter({ id: "chatgpt" }));

  assert.equal(context.AIHR_PLATFORMS.forUrl("https://chatgpt.com/c/1").id, "chatgpt");
});

test("bridge protocol accepts known content messages and rejects unknown or incompatible messages", () => {
  const context = loadExtensionScripts(["extension/core/constants.js", "extension/core/protocol.js"]);

  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_WEB_GET_STATUS" }).ok, true);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_CONTENT_PING", protocolVersion: 1 }).ok, true);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "UNKNOWN" }).ok, false);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_WEB_GET_STATUS", protocolVersion: 999 }).ok, false);
});

test("content bridge blocks unknown and incompatible page messages before runtime dispatch", () => {
  const bridge = loadContentBridge();

  bridge.dispatch({ type: "AIHR_WEB_START_CAPTURE", protocolVersion: 999 });
  bridge.dispatch({ type: "UNKNOWN" });

  assert.deepEqual(bridge.sentMessages, []);
});

test("content bridge accepts legacy page messages without a protocol version", () => {
  const bridge = loadContentBridge();

  bridge.dispatch({ type: "AIHR_WEB_GET_STATUS" });

  assert.equal(bridge.sentMessages.length, 1);
  assert.equal(bridge.sentMessages[0].type, "AIHR_GET_RUN_STATUS");
});

test("manifest loads content contracts before the existing coordinator", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));

  assert.deepEqual(manifest.content_scripts[0].js, [
    "core/constants.js",
    "core/protocol.js",
    "platforms/registry.js",
    "core/dom.js",
    "platforms/chatgpt.js",
    "platforms/gemini.js",
    "platforms/deepseek.js",
    "platforms/qwen.js",
    "incremental-sync.js",
    "content.js"
  ]);
  assert.equal(manifest.background.service_worker, "background-entry.js");
});

test("programmatic injection matches the manifest content module order", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");
  const match = background.match(/function injectContentScript\(tabId\) \{[\s\S]*?files: \[([\s\S]*?)\][\s\S]*?\n\}/);
  assert.ok(match);
  const injectedFiles = [...match[1].matchAll(/"([^"]+)"/g)].map((file) => file[1]);

  for (const file of injectedFiles) {
    assert.equal(fs.existsSync(path.join(process.cwd(), "extension", file)), true);
  }
  assert.deepEqual(injectedFiles, manifest.content_scripts[0].js);
});
