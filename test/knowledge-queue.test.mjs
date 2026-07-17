import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const {
  claimKnowledgeJobs,
  completeKnowledgeJob,
  enqueueKnowledgeJob,
  failKnowledgeJob,
  getKnowledgeQueueStatus
} = await import("../src/services/knowledge-queue-service.ts");
const { getDb } = await import("../src/lib/db.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-knowledge-queue-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
  const db = getDb();
  db.prepare(
    "INSERT INTO conversations (id, source_platform, title, imported_at) VALUES (?, 'chatgpt', ?, ?)"
  ).run("conversation-1", "Queue fixture", "2026-01-01T00:00:00.000Z");
  return db;
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("enqueue deduplicates the same fingerprint", () => {
  useTempDb();

  const first = enqueueKnowledgeJob("conversation-1", "process", "hash-1");
  const second = enqueueKnowledgeJob("conversation-1", "process", "hash-1");

  assert.equal(second.id, first.id);
  assert.equal(getKnowledgeQueueStatus().pending, 1);
});

test("a new fingerprint supersedes older pending work", () => {
  const db = useTempDb();

  const oldJob = enqueueKnowledgeJob("conversation-1", "process", "hash-old");
  const newJob = enqueueKnowledgeJob("conversation-1", "process", "hash-new");
  const oldRow = db.prepare("SELECT status, completion_reason FROM knowledge_jobs WHERE id = ?").get(oldJob.id);

  assert.notEqual(newJob.id, oldJob.id);
  assert.deepEqual(oldRow, { status: "completed", completion_reason: "superseded" });
  assert.equal(getKnowledgeQueueStatus().pending, 1);
});

test("expired running lease is claimable after restart", () => {
  useTempDb();
  enqueueKnowledgeJob("conversation-1", "process", "hash-1", "2026-01-01T00:00:00.000Z");

  const [first] = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:00:00.000Z" });
  const beforeExpiry = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:04:59.000Z" });
  const [reclaimed] = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:05:01.000Z" });

  assert.equal(beforeExpiry.length, 0);
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.attempts, 2);
});

test("failures back off and become terminal after five attempts", () => {
  useTempDb();
  enqueueKnowledgeJob("conversation-1", "process", "hash-1", "2026-01-01T00:00:00.000Z");

  let now = "2026-01-01T00:00:00.000Z";
  let job = claimKnowledgeJobs({ limit: 1, now })[0];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    failKnowledgeJob(job.id, new Error(`failure ${attempt}`), now);
    const status = getKnowledgeQueueStatus();
    if (attempt < 5) {
      assert.equal(status.pending, 1);
      now = new Date(Date.parse(now) + 2 ** attempt * 60_000 + 1_000).toISOString();
      job = claimKnowledgeJobs({ limit: 1, now })[0];
    } else {
      assert.equal(status.failed, 1);
      assert.equal(status.pending, 0);
    }
  }
});

test("completed jobs leave the active queue", () => {
  useTempDb();
  enqueueKnowledgeJob("conversation-1", "process", "hash-1", "2026-01-01T00:00:00.000Z");
  const [job] = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:00:00.000Z" });

  completeKnowledgeJob(job.id, "2026-01-01T00:01:00.000Z");

  assert.deepEqual(getKnowledgeQueueStatus(), {
    pending: 0,
    running: 0,
    completed: 1,
    failed: 0,
    total: 1
  });
});

test("knowledge records cascade with conversations and similarity pairs stay normalized", () => {
  const db = useTempDb();
  db.prepare(
    "INSERT INTO conversations (id, source_platform, title, imported_at) VALUES (?, 'chatgpt', ?, ?)"
  ).run("conversation-2", "Second fixture", "2026-01-01T00:00:00.000Z");
  enqueueKnowledgeJob("conversation-1", "process", "hash-1");
  db.prepare(
    "INSERT INTO conversation_insights (conversation_id, fingerprint, summary, generator, generator_version, generated_at, updated_at) VALUES (?, ?, ?, 'rule', 'v1', ?, ?)"
  ).run("conversation-1", "hash-1", "summary", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO auto_conversation_tags (conversation_id, tag, fingerprint, generator, created_at) VALUES (?, 'sqlite', ?, 'rule', ?)"
  ).run("conversation-1", "hash-1", "2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO conversation_similarities (left_conversation_id, right_conversation_id, score, fingerprint, updated_at) VALUES (?, ?, 0.8, ?, ?)"
  ).run("conversation-1", "conversation-2", "hash-1", "2026-01-01T00:00:00.000Z");

  assert.throws(() => {
    db.prepare(
      "INSERT INTO conversation_similarities (left_conversation_id, right_conversation_id, score, fingerprint, updated_at) VALUES (?, ?, 0.8, ?, ?)"
    ).run("conversation-2", "conversation-1", "hash-1", "2026-01-01T00:00:00.000Z");
  }, /CHECK constraint failed/);

  db.prepare("DELETE FROM conversations WHERE id = ?").run("conversation-1");
  for (const table of ["knowledge_jobs", "conversation_insights", "auto_conversation_tags", "conversation_similarities"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
});
