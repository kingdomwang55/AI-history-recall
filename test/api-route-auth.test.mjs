import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { GET } = await import("../src/app/api/capture/audit/route.ts");
const healthRoute = await import("../src/app/api/health/route.ts");
const knowledgeProcessRoute = await import("../src/app/api/knowledge/process/route.ts");
const knowledgeStatusRoute = await import("../src/app/api/knowledge/status/route.ts");

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
  delete process.env.LLM_API_KEY;
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

test("health route rejects missing API tokens when configured", async () => {
  process.env.AIHR_API_TOKEN = "route-secret";

  const response = await healthRoute.GET(new Request("http://localhost/api/health"));

  assert.equal(response.status, 401);
});

test("health route returns a redacted report with the shared token", async () => {
  process.env.AIHR_API_TOKEN = "route-secret";
  useTempDb();

  const response = await healthRoute.GET(
    new Request("http://localhost/api/health", {
      headers: { "X-AIHR-API-Token": "route-secret" }
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body.health.checks), true);
  assert.doesNotMatch(JSON.stringify(body), /route-secret/);
});

test("knowledge routes require auth and expose no API key", async () => {
  process.env.AIHR_API_TOKEN = "route-secret";
  process.env.LLM_API_KEY = "model-secret";
  useTempDb();

  const rejectedStatus = await knowledgeStatusRoute.GET(
    new Request("http://localhost/api/knowledge/status")
  );
  const rejectedProcess = await knowledgeProcessRoute.POST(
    new Request("http://localhost/api/knowledge/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    })
  );
  assert.equal(rejectedStatus.status, 401);
  assert.equal(rejectedProcess.status, 401);

  const accepted = await knowledgeStatusRoute.GET(
    new Request("http://localhost/api/knowledge/status", {
      headers: { "X-AIHR-API-Token": "route-secret" }
    })
  );
  const body = await accepted.json();
  assert.equal(accepted.status, 200);
  assert.equal(body.model.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(body), /model-secret|route-secret/);
});
