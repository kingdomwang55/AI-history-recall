import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadCoreModule(file, globals = {}) {
  const context = vm.createContext({ URL, ...globals });
  context.globalThis = context;
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "core", file), "utf8");
  vm.runInContext(source, context, { filename: file });
  return context;
}

function memoryStorage(initial) {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(next) {
      value = next;
    },
    async remove() {
      value = null;
    }
  };
}

test("API client probes desktop before development endpoint", async () => {
  const calls = [];
  const context = loadCoreModule("api-client.js", {
    AIHR_CONSTANTS: {
      endpointCandidates: ["http://127.0.0.1:32145", "http://127.0.0.1:3000"]
    }
  });
  const api = context.AIHR_API.createApiClient({
    fetch: async (url) => {
      calls.push(url);
      return { ok: calls.length === 2, json: async () => ({ ok: true }) };
    }
  });

  await api.request("/api/health");

  assert.deepEqual(calls.map((url) => new URL(url).port), ["32145", "3000"]);
});

test("queue restores a running target as pending after lease expiry", async () => {
  const context = loadCoreModule("capture-queue.js");
  const queue = context.AIHR_CAPTURE_QUEUE.createQueue(
    memoryStorage({ status: "running", leaseUntil: 1 })
  );

  assert.equal((await queue.restore(2)).status, "pending");
});
