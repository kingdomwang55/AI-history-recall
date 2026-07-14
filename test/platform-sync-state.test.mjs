import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const {
  getPlatformSyncStates,
  markPlatformSyncDiscovered,
  markPlatformSyncFailed,
  markPlatformSyncStarted,
  markPlatformSyncSucceeded
} = await import("../src/services/platform-sync-service.ts");
const { getCaptureAudit } = await import("../src/services/capture-audit-service.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-sync-state-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("tracks platform discovery, success counts, and failure backoff", () => {
  useTempDb();

  markPlatformSyncStarted("chatgpt");
  let chatgpt = getPlatformSyncStates().find((state) => state.platform === "chatgpt");
  assert.equal(chatgpt.status, "syncing");

  markPlatformSyncDiscovered("chatgpt", "https://chatgpt.com/c/latest");
  markPlatformSyncSucceeded("chatgpt", {
    newConversations: 2,
    newMessages: 7,
    lastSeenUrl: "https://chatgpt.com/c/latest"
  });

  chatgpt = getPlatformSyncStates().find((state) => state.platform === "chatgpt");
  assert.equal(chatgpt.status, "idle");
  assert.equal(chatgpt.lastSeenUrl, "https://chatgpt.com/c/latest");
  assert.equal(chatgpt.lastNewConversations, 2);
  assert.equal(chatgpt.lastNewMessages, 7);
  assert.equal(chatgpt.lastError, null);
  assert.ok(chatgpt.lastDiscoveredAt);
  assert.ok(chatgpt.lastSyncedAt);
  assert.ok(chatgpt.lastSuccessAt);

  markPlatformSyncFailed("chatgpt", "rate limited", "2099-01-01T00:00:00.000Z");
  chatgpt = getPlatformSyncStates().find((state) => state.platform === "chatgpt");
  assert.equal(chatgpt.status, "error");
  assert.equal(chatgpt.lastError, "rate limited");
  assert.equal(chatgpt.consecutiveFailures, 1);
  assert.equal(chatgpt.backoffUntil, "2099-01-01T00:00:00.000Z");

  assert.deepEqual(
    getPlatformSyncStates().map((state) => state.platform),
    ["chatgpt", "gemini", "deepseek", "qwen"]
  );

  const auditState = getCaptureAudit().platforms.find((platform) => platform.platform === "chatgpt");
  assert.equal(auditState.syncState.lastError, "rate limited");
  assert.equal(auditState.syncState.lastNewMessages, 7);
});

test("sync state API records extension lifecycle events", async () => {
  useTempDb();
  const { GET, POST } = await import("../src/app/api/extension/sync-state/route.ts");

  const started = await POST(
    new Request("http://localhost:3000/api/extension/sync-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "gemini", event: "started" })
    })
  );
  assert.equal(started.status, 200);

  const succeeded = await POST(
    new Request("http://localhost:3000/api/extension/sync-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "gemini",
        event: "succeeded",
        newConversations: 1,
        newMessages: 4,
        lastSeenUrl: "https://gemini.google.com/app/latest"
      })
    })
  );
  assert.equal(succeeded.status, 200);

  const response = await GET(new Request("http://localhost:3000/api/extension/sync-state"));
  const payload = await response.json();
  const gemini = payload.states.find((state) => state.platform === "gemini");
  assert.equal(gemini.lastNewConversations, 1);
  assert.equal(gemini.lastNewMessages, 4);
  assert.equal(gemini.lastSeenUrl, "https://gemini.google.com/app/latest");
});

test("incremental discovery does not replace full-capture exhaustion evidence", async () => {
  useTempDb();
  const { POST } = await import("../src/app/api/extension/discovery-run/route.ts");

  const recordDiscovery = (body) =>
    POST(
      new Request("http://localhost:3000/api/extension/discovery-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "chatgpt",
          targetsFound: 5,
          scannedTitlesCount: 5,
          failuresCount: 0,
          extensionVersion: "0.1.39",
          extensionBuildId: "incremental-sync-20260714",
          ...body
        })
      })
    );

  assert.equal(
    (await recordDiscovery({ mode: "full", stopReason: "no_new_targets", exhaustive: true })).status,
    200
  );
  assert.equal(
    (await recordDiscovery({ mode: "incremental", stopReason: "known_streak", exhaustive: false })).status,
    200
  );

  const latestFull = getCaptureAudit().platforms.find((platform) => platform.platform === "chatgpt")
    .latestDiscovery;
  assert.equal(latestFull.stopReason, "no_new_targets");
  assert.equal(latestFull.exhausted, true);
});
