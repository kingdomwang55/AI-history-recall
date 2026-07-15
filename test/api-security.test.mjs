import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);

const { getDb } = await import("../src/lib/db.ts");
const { POST: importPost } = await import("../src/app/api/import/route.ts");
const { POST: chromePost } = await import("../src/app/api/capture/chrome/route.ts");
const { POST: browserPost } = await import("../src/app/api/capture/browser/route.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_API_TOKEN;
});

test("database files are created with private permissions", () => {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-db-mode-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  process.env.AIHR_DB_PATH = dbPath;

  getDb().prepare("SELECT 1").get();

  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);
});

test("import route rejects oversized uploads before parsing form data", async () => {
  const response = await importPost(
    new Request("http://localhost/api/import", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-length": String(26 * 1024 * 1024)
      },
      body: new FormData()
    })
  );

  assert.equal(response.status, 413);
});

test("chrome launch route rejects invalid CDP ports", async () => {
  const response = await chromePost(
    new Request("http://localhost/api/capture/chrome", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json"
      },
      body: JSON.stringify({ port: 80, chromePath: "/tmp/not-allowed", userDataDir: "/tmp/not-allowed" })
    })
  );

  assert.equal(response.status, 400);
});

test("browser capture rejects targets outside the selected platform", async () => {
  const response = await browserPost(
    new Request("http://localhost/api/capture/browser", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        targets: [{ platform: "chatgpt", url: "https://example.com/c/not-allowed" }]
      })
    })
  );

  assert.equal(response.status, 400);
});
