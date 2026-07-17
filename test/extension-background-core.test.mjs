import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadCoreModules(files, globals = {}) {
  const context = vm.createContext({ URL, ...globals });
  context.globalThis = context;
  for (const file of files) {
    const source = fs.readFileSync(path.join(process.cwd(), "extension", "core", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function loadCoreModule(file, globals = {}) {
  return loadCoreModules([file], globals);
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
    },
    snapshot() {
      return value;
    }
  };
}

function productionRun(overrides = {}) {
  return {
    id: "run-1",
    extensionVersion: "0.1.44",
    extensionBuildId: "desktop-websocket-20260717",
    status: "running",
    phase: "capturing",
    startedAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    queue: [
      { platform: "chatgpt", url: "https://chatgpt.com/c/one", title: "One" },
      { platform: "gemini", url: "https://gemini.google.com/app/two", title: "Two" }
    ],
    queuePlatformCounts: { chatgpt: 1, gemini: 1 },
    nextIndex: 0,
    totalTargets: 2,
    processed: 0,
    importedConversations: 0,
    importedMessages: 0,
    skippedDuplicates: 0,
    failures: [],
    platformResults: {},
    processing: false,
    processingStartedAt: null,
    processingToken: null,
    leaseUntil: null,
    currentTarget: null,
    stopRequested: false,
    options: { pageDelayMs: 5200, pageJitterMs: 3200 },
    ...overrides
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
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

test("API client pairs with the desktop daemon and persists its token", async () => {
  const storage = memoryStorage({});
  const calls = [];
  const context = loadCoreModule("api-client.js");
  const api = context.AIHR_API.createApiClient({
    endpointCandidates: ["http://127.0.0.1:32145"],
    storage,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ token: "desktop-secret" }) };
    }
  });

  const paired = await api.pairDesktop("desktop-websocket-20260717");

  assert.equal(paired.ok, true);
  assert.equal(storage.snapshot().aihrLocalApiToken, "desktop-secret");
  assert.equal(calls[0].options.headers["X-AIHR-Extension-Build"], "desktop-websocket-20260717");
});

test("API client rejects off-loopback candidates without token or fetch dispatch", async () => {
  let tokenReads = 0;
  let fetchCalls = 0;
  const context = loadCoreModule("api-client.js");

  assert.throws(
    () =>
      context.AIHR_API.createApiClient({
        endpointCandidates: ["https://example.com"],
        storage: {
          async get() {
            tokenReads += 1;
            return { aihrLocalApiToken: "secret" };
          }
        },
        fetch: async () => {
          fetchCalls += 1;
          return { ok: true };
        }
      }),
    /loopback/i
  );

  assert.equal(tokenReads, 0);
  assert.equal(fetchCalls, 0);
});

test("API client rejects absolute and protocol-relative escape paths before token dispatch", async () => {
  let tokenReads = 0;
  const calls = [];
  const context = loadCoreModule("api-client.js");
  const api = context.AIHR_API.createApiClient({
    endpointCandidates: ["http://127.0.0.1:32145"],
    storage: {
      async get() {
        tokenReads += 1;
        return { aihrLocalApiToken: "secret" };
      }
    },
    fetch: async (url) => {
      calls.push(url);
      return { ok: true };
    }
  });

  await assert.rejects(api.request("https://example.com/api/health"), /local API path/i);
  await assert.rejects(api.request("//example.com/api/health"), /local API path/i);

  assert.equal(tokenReads, 0);
  assert.deepEqual(calls, []);
});

test("queue restores an expired production capture lease without advancing the target", async () => {
  const context = loadCoreModule("capture-queue.js");
  const queue = context.AIHR_CAPTURE_QUEUE.createQueue(memoryStorage(
    productionRun({
      processing: true,
      processingStartedAt: "1970-01-01T00:00:00.001Z",
      processingToken: "expired-claim",
      leaseUntil: 1,
      currentTarget: {
        platform: "chatgpt",
        url: "https://chatgpt.com/c/one",
        title: "One",
        index: 1,
        total: 2
      }
    })
  ));

  const restored = await queue.restore(2);

  assert.equal(restored.status, "running");
  assert.equal(restored.phase, "capturing");
  assert.equal(restored.processing, false);
  assert.equal(restored.processingToken, null);
  assert.equal(restored.nextIndex, 0);
  assert.equal(restored.currentTarget, null);
});

test("queue owns initialize, resume, claim, success, and failure snapshots", async () => {
  const context = loadCoreModule("capture-queue.js");
  const storage = memoryStorage(productionRun({ status: "stopped", phase: "stopped", queue: [] }));
  const tokens = ["claim-one", "claim-two"];
  const queue = context.AIHR_CAPTURE_QUEUE.createQueue(storage, {
    now: () => 10_000,
    tokenFactory: () => tokens.shift()
  });
  const targets = productionRun().queue;

  let snapshot = await queue.initialize(targets, { pageDelayMs: 5200, pageJitterMs: 3200 });
  assert.equal(queue.snapshot(), snapshot);
  assert.deepEqual(plain(snapshot.queuePlatformCounts), { chatgpt: 1, gemini: 1 });

  snapshot = await queue.resume();
  assert.equal(queue.snapshot(), snapshot);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.phase, "capturing");

  let claim = await queue.claim();
  snapshot = claim.snapshot;
  assert.equal(claim.token, "claim-one");
  assert.equal(queue.snapshot(), snapshot);
  assert.equal(snapshot.processing, true);
  assert.equal(snapshot.leaseUntil, 190_000);
  assert.deepEqual(plain(snapshot.currentTarget), {
    platform: "chatgpt",
    title: "One",
    url: "https://chatgpt.com/c/one",
    index: 1,
    total: 2
  });

  let completion = await queue.succeed(claim, {
    imported: { importedConversations: 1, importedMessages: 3, skippedDuplicates: 2 }
  });
  snapshot = completion.snapshot;
  assert.equal(completion.stale, false);
  assert.equal(queue.snapshot(), snapshot);
  assert.equal(snapshot.nextIndex, 1);
  assert.equal(snapshot.processed, 1);
  assert.equal(snapshot.importedConversations, 1);
  assert.equal(snapshot.importedMessages, 3);
  assert.equal(snapshot.skippedDuplicates, 2);
  assert.deepEqual(plain(snapshot.platformResults), {
    chatgpt: { newConversations: 1, newMessages: 3 }
  });

  claim = await queue.claim();
  completion = await queue.fail(claim, new Error("capture failed"));
  snapshot = completion.snapshot;
  assert.equal(completion.stale, false);
  assert.equal(queue.snapshot(), snapshot);
  assert.equal(storage.snapshot(), snapshot);
  assert.equal(snapshot.nextIndex, 2);
  assert.equal(snapshot.processed, 2);
  assert.deepEqual(plain(snapshot.failures), [
    {
      platform: "gemini",
      url: "https://gemini.google.com/app/two",
      title: "Two",
      error: "capture failed"
    }
  ]);
});

test("ordinary production claim arms the persistent capture alarm for lease expiry", async () => {
  const context = loadCoreModules(["scheduler.js", "capture-queue.js"]);
  const alarms = [];
  const scheduler = context.AIHR_SCHEDULER.createScheduler({
    alarms: {
      async create(name, alarmInfo) {
        alarms.push({ name, alarmInfo });
      },
      async clear() {},
      onAlarm() {}
    },
    storage: {
      async get() {
        return {};
      },
      async set() {},
      async remove() {}
    },
    now: () => 10_000,
    random: () => 0
  });
  const queue = context.AIHR_CAPTURE_QUEUE.createQueue(memoryStorage(productionRun()), {
    now: () => 10_000,
    tokenFactory: () => "watchdog-claim",
    armLease: scheduler.scheduleQueueLease
  });

  const claimed = await queue.claim();

  assert.equal(claimed.token, "watchdog-claim");
  assert.equal(claimed.snapshot.leaseUntil, 190_000);
  assert.deepEqual(plain(alarms), [
    { name: "aihr_process_capture_queue", alarmInfo: { when: 190_000 } }
  ]);
});

test("stale claim completion cannot mutate a recovered retry", async () => {
  const context = loadCoreModule("capture-queue.js");
  const storage = memoryStorage(productionRun());
  const tokens = ["claim-a", "claim-b"];
  let now = 10_000;
  const queue = context.AIHR_CAPTURE_QUEUE.createQueue(storage, {
    now: () => now,
    tokenFactory: () => tokens.shift()
  });

  const claimA = await queue.claim();
  assert.equal(claimA.token, "claim-a");

  now = claimA.snapshot.leaseUntil + 1;
  const recovered = await queue.restore(now);
  assert.equal(recovered.processingToken, null);

  const claimB = await queue.claim();
  assert.equal(claimB.token, "claim-b");
  assert.equal(claimB.target.url, productionRun().queue[0].url);

  const staleSuccess = await queue.succeed(claimA, {
    imported: { importedConversations: 9, importedMessages: 99, skippedDuplicates: 4 }
  });
  assert.equal(staleSuccess.stale, true);
  assert.equal(staleSuccess.snapshot.processingToken, "claim-b");
  assert.equal(staleSuccess.snapshot.nextIndex, 0);
  assert.equal(staleSuccess.snapshot.processed, 0);

  const staleFailure = await queue.fail(claimA, new Error("late failure"));
  assert.equal(staleFailure.stale, true);
  assert.equal(staleFailure.snapshot.processingToken, "claim-b");
  assert.deepEqual(plain(staleFailure.snapshot.failures), []);

  const completed = await queue.succeed(claimB, {
    imported: { importedConversations: 1, importedMessages: 3, skippedDuplicates: 0 }
  });
  assert.equal(completed.stale, false);
  assert.equal(completed.snapshot.nextIndex, 1);
  assert.equal(completed.snapshot.processed, 1);
  assert.equal(completed.snapshot.importedConversations, 1);
  assert.equal(completed.snapshot.importedMessages, 3);
  assert.equal(completed.snapshot.processingToken, null);
});

test("background coordinator delegates persisted queue transitions without a mutable run mirror", () => {
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");

  assert.equal(/\blet activeRun\b/.test(background), false);
  assert.equal(/function (?:initializeQueue|resumeQueue)\b/.test(background), false);
  for (const method of ["initialize", "resume", "claim", "succeed", "fail"]) {
    assert.match(background, new RegExp(`captureQueue\\.${method}\\b`));
  }
  assert.match(background, /captureQueue\.succeed\(claim,\s*data\)/);
  assert.match(background, /captureQueue\.fail\(claim,\s*error\)/);
});
