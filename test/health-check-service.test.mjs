import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const {
  aggregateHealth,
  getHealthReport,
  recordHealthSnapshot,
  redactHealthReport
} = await import("../src/services/health-check-service.ts");
const { getDb } = await import("../src/lib/db.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-health-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
  return dir;
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_EMBEDDING_PROVIDER;
  delete process.env.AIHR_EMBEDDING_MODEL;
  delete process.env.AIHR_EMBEDDING_BASE_URL;
  delete process.env.AIHR_EMBEDDING_API_KEY;
});

test("disabled optional model is healthy-neutral", () => {
  const report = aggregateHealth([
    { id: "database", label: "数据库", status: "healthy", evidence: "ok" },
    { id: "model", label: "模型", status: "disabled", evidence: "未启用" }
  ]);

  assert.equal(report.status, "healthy");
});

test("diagnostic report removes secrets content and absolute paths", () => {
  const report = {
    status: "degraded",
    generatedAt: "2026-07-17T00:00:00.000Z",
    checks: [
      {
        id: "unsafe",
        label: "Unsafe",
        status: "degraded",
        evidence:
          "token-value conversation text /Users/example/private/data.sqlite C:\\Users\\example\\secret.db Bearer abc123",
        details: {
          apiKey: "token-value",
          content: "conversation text",
          safeCount: 4
        }
      }
    ]
  };

  const output = JSON.stringify(redactHealthReport(report));

  assert.doesNotMatch(output, /token-value|conversation text|\/Users\/|C:\\Users\\|abc123/);
  assert.match(output, /safeCount/);
});

test("routine health polling is read-only and reports disabled model", () => {
  useTempDb();
  const db = getDb();

  const first = getHealthReport();
  const second = getHealthReport();
  const snapshots = db.prepare("SELECT COUNT(*) AS count FROM health_check_runs").get();

  assert.equal(first.checks.find((check) => check.id === "model")?.status, "disabled");
  assert.equal(second.checks.length, first.checks.length);
  assert.equal(snapshots.count, 0);
});

test("semantic coverage ignores rows from a previously configured model", () => {
  useTempDb();
  const db = getDb();
  const timestamp = "2026-07-17T00:00:00.000Z";
  db.prepare(
    "INSERT INTO conversations (id, source_platform, title, imported_at) VALUES ('c1', 'chatgpt', 'Model switch', ?)"
  ).run(timestamp);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, order_index) VALUES ('m1', 'c1', 'user', 'hello', 0)"
  ).run();
  db.prepare(
    "INSERT INTO semantic_index (message_id, conversation_id, model, dimensions, content_hash, title, content, source_platform, role, imported_at, vector, updated_at) VALUES ('m1', 'c1', 'aihr-local-hash-v1', 192, 'hash', 'Model switch', 'hello', 'chatgpt', 'user', ?, ?, ?)"
  ).run(timestamp, Buffer.alloc(192 * 4), timestamp);
  process.env.AIHR_EMBEDDING_PROVIDER = "ollama";
  process.env.AIHR_EMBEDDING_MODEL = "embeddinggemma";

  const semantic = getHealthReport().checks.find((check) => check.id === "semantic");

  assert.equal(semantic?.status, "degraded");
  assert.match(semantic?.evidence ?? "", /^0\/1/);
});

test("health report remains available when the database cannot be opened", () => {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-health-broken-db-"));
  const blockingFile = path.join(dir, "not-a-directory");
  fs.writeFileSync(blockingFile, "blocked");
  process.env.AIHR_DB_PATH = path.join(blockingFile, "test.sqlite");

  const report = getHealthReport();

  assert.equal(report.status, "unavailable");
  assert.equal(report.checks.find((check) => check.id === "database")?.status, "unavailable");
  assert.equal(report.checks.find((check) => check.id === "model")?.status, "disabled");
});

test("explicit snapshots retain only the newest one hundred rows", () => {
  useTempDb();

  for (let index = 0; index < 105; index += 1) {
    recordHealthSnapshot({
      status: "healthy",
      generatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      checks: [{ id: "database", label: "数据库", status: "healthy", evidence: `run ${index}` }]
    });
  }

  const rows = getDb()
    .prepare("SELECT generated_at FROM health_check_runs ORDER BY generated_at ASC")
    .all();
  assert.equal(rows.length, 100);
  assert.equal(rows[0].generated_at, "2026-01-01T00:00:05.000Z");
});
