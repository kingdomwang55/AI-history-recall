import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

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
    const metrics = await request(daemon, "/metrics", {
      headers: { "X-AIHR-API-Token": "pairing-secret" }
    });
    assert.equal(metrics.status, 200);
    assert.equal((await metrics.json()).schedulerWakeups, 0);
  } finally {
    await daemon.close();
  }
});

test("desktop extension pairs directly with the loopback daemon", async () => {
  const daemon = await startDaemon(daemonOptions());
  try {
    const rejected = await request(daemon, "/api/desktop/pair-extension", {
      method: "POST",
      headers: { "X-AIHR-Extension-Build": "unknown" }
    });
    const paired = await request(daemon, "/api/desktop/pair-extension", {
      method: "POST",
      headers: { "X-AIHR-Extension-Build": "desktop-websocket-20260717" }
    });

    assert.equal(rejected.status, 403);
    assert.equal(paired.status, 200);
    assert.equal((await paired.json()).token, "pairing-secret");
  } finally {
    await daemon.close();
  }
});

test("desktop bridge relays commands between the app and extension", async () => {
  const daemon = await startDaemon(daemonOptions());
  const headers = { "X-AIHR-API-Token": "pairing-secret" };
  try {
    const poll = request(daemon, "/api/desktop/extension-bridge", {
      headers: { ...headers, "X-AIHR-Extension-Version": "0.1.44", "X-AIHR-Extension-Build": "desktop-websocket-20260717" }
    }).then((response) => response.json());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const appCommand = request(daemon, "/api/desktop/extension-bridge", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ kind: "command", message: { type: "AIHR_WEB_GET_STATUS" } })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const command = (await poll).command;
    assert.equal(command.message.type, "AIHR_WEB_GET_STATUS");
    await request(daemon, "/api/desktop/extension-bridge", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ kind: "result", id: command.id, result: { ok: true, run: { status: "idle" } } })
    });
    const result = await appCommand;
    assert.equal(result.status, 200);
    assert.equal(result.body.run.status, "idle");
  } finally {
    await daemon.close();
  }
});

test("desktop WebSocket keeps the extension online and relays commands", async () => {
  const daemon = await startDaemon(daemonOptions());
  const socket = new WebSocket(
    `${daemon.url.replace("http:", "ws:")}/api/desktop/extension-socket?token=pairing-secret&version=0.1.44&buildId=desktop-websocket-20260717`
  );
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString());
      if (payload.type === "command") {
        socket.send(JSON.stringify({ type: "result", id: payload.command.id, result: { ok: true, run: { status: "idle" } } }));
      }
    });
    const status = await request(daemon, "/api/desktop/extension-status", {
      headers: { "X-AIHR-API-Token": "pairing-secret" }
    });
    const command = await request(daemon, "/api/desktop/extension-bridge", {
      method: "POST",
      headers: { "X-AIHR-API-Token": "pairing-secret", "content-type": "application/json" },
      body: JSON.stringify({ kind: "command", message: { type: "AIHR_WEB_GET_STATUS" } })
    });
    const statusBody = await status.json();
    assert.equal(statusBody.connected, true);
    assert.equal(statusBody.transport, "websocket");
    assert.equal((await command.json()).run.status, "idle");
  } finally {
    socket.close();
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
