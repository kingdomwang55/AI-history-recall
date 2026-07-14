import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { GET } = await import("../src/app/api/capture/audit/route.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-route-auth-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_API_TOKEN;
  delete process.env.AIHR_DB_PATH;
});

test("capture audit route rejects missing API tokens when configured", async () => {
  process.env.AIHR_API_TOKEN = "route-secret";

  const response = await GET(new Request("http://localhost/api/capture/audit"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Missing or invalid local API token"
  });
});

test("capture audit route accepts the shared API token without a Next server", async () => {
  process.env.AIHR_API_TOKEN = "route-secret";
  useTempDb();

  const response = await GET(
    new Request("http://localhost/api/capture/audit", {
      headers: {
        "X-AIHR-API-Token": "route-secret"
      }
    })
  );
  const body = await response.json();

  assert.notEqual(response.status, 401);
  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body.audit.platforms), true);
});
