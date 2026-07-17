import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { startDaemon } = await import("../desktop/daemon-entry.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function daemonOptions() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-daemon-test-"));
  return {
    host: "127.0.0.1",
    port: 0,
    token: "pairing-secret",
    dbPath: path.join(dataDir, "daemon.sqlite"),
    dataDir,
    scheduler: false
  };
}

async function request(daemon, pathname, options = {}) {
  return fetch(`${daemon.url}${pathname}`, options);
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_API_TOKEN;
});

test("daemon rejects non-loopback bind addresses", async () => {
  await assert.rejects(
    () => startDaemon({ ...daemonOptions(), host: "0.0.0.0" }),
    /loopback/i
  );
});

test("daemon exposes unauthenticated readiness but requires pairing token for writes", async () => {
  const daemon = await startDaemon(daemonOptions());
  try {
    const ready = await request(daemon, "/ready");
    const rejected = await request(daemon, "/api/extension/capture-page", {
      method: "POST",
      headers: { "content-type": "application/json", "X-AIHR-API-Token": "wrong" },
      body: "{}"
    });

    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
    assert.equal(rejected.status, 401);
  } finally {
    await daemon.close();
  }
});

test("daemon captures through the shared extension service", async () => {
  const daemon = await startDaemon(daemonOptions());
  try {
    const response = await request(daemon, "/api/extension/capture-page", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-AIHR-API-Token": "pairing-secret"
      },
      body: JSON.stringify({
        platform: "chatgpt",
        url: "https://chatgpt.com/c/desktop-daemon",
        title: "Desktop daemon capture",
        messages: [
          { role: "user", content: "Can the tray daemon capture this conversation?" },
          { role: "assistant", content: "Yes, without starting the Next.js UI." }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.imported.importedConversations, 1);
  } finally {
    await daemon.close();
  }
});

test("daemon enforces method allowlists and JSON body limits", async () => {
  const daemon = await startDaemon(daemonOptions());
  try {
    const method = await request(daemon, "/api/health", {
      method: "POST",
      headers: { "X-AIHR-API-Token": "pairing-secret" }
    });
    const oversized = await request(daemon, "/api/extension/capture-page", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-AIHR-API-Token": "pairing-secret"
      },
      body: JSON.stringify({ content: "x".repeat(300_000) })
    });

    assert.equal(method.status, 405);
    assert.equal(oversized.status, 413);
  } finally {
    await daemon.close();
  }
});
