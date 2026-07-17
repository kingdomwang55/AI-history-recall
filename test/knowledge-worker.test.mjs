import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { getDb } = await import("../src/lib/db.ts");
const { getKnowledgeQueueStatus } = await import("../src/services/knowledge-queue-service.ts");
const { processKnowledgeBatch } = await import("../src/services/knowledge-worker-service.ts");
const knowledgeProcessRoute = await import("../src/app/api/knowledge/process/route.ts");
const { enhanceKnowledgeWithModel, getKnowledgeModelStatus } = await import(
  "../src/services/knowledge-model-service.ts"
);

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-knowledge-worker-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

function seedSemanticPeers(count = 2) {
  return importParsedConversations(
    [
      {
        title: "语义搜索升级",
        sourcePlatform: "chatgpt",
        sourceUrl: "https://chatgpt.com/c/worker-semantic",
        messages: [
          { role: "user", content: "如何升级 SQLite 语义搜索和向量召回？" },
          { role: "assistant", content: "最终建议合并全文检索与 embedding 向量分数。" }
        ]
      },
      {
        title: "混合向量检索",
        sourcePlatform: "gemini",
        sourceUrl: "https://gemini.google.com/app/worker-vector",
        messages: [
          { role: "user", content: "怎样通过 embedding 找到措辞不同但含义相近的问题？" },
          { role: "assistant", content: "使用向量余弦相似度和关键词共同排序。" }
        ]
      }
    ].slice(0, count),
    "worker.json",
    "fixture"
  );
}

function countRows(table) {
  return getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_KNOWLEDGE_MODEL_ENABLED;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
});

test("model timeout keeps rule output and completes the job", async () => {
  useTempDb();
  seedSemanticPeers(1);

  const result = await processKnowledgeBatch({
    limit: 1,
    enhance: async () => {
      throw new Error("timeout");
    }
  });
  const insight = getDb().prepare("SELECT generator, summary FROM conversation_insights").get();

  assert.equal(result.completed, 1);
  assert.equal(result.modelDegraded, 1);
  assert.equal(insight.generator, "rule");
  assert.match(insight.summary, /语义搜索/);
  assert.equal(getKnowledgeQueueStatus().running, 0);
});

test("worker writes insight tags and similarities atomically", async () => {
  useTempDb();
  seedSemanticPeers();

  const result = await processKnowledgeBatch({ limit: 1 });

  assert.equal(result.completed, 1);
  assert.equal(countRows("conversation_insights"), 1);
  assert.ok(countRows("auto_conversation_tags") > 0);
  assert.ok(countRows("conversation_similarities") > 0);
  assert.equal(getKnowledgeQueueStatus().running, 0);
});

test("worker rolls back generated knowledge when similarity persistence fails", async () => {
  useTempDb();
  seedSemanticPeers();
  getDb().exec(`
    CREATE TRIGGER reject_similarity_insert
    BEFORE INSERT ON conversation_similarities
    BEGIN
      SELECT RAISE(ABORT, 'similarity write rejected');
    END;
  `);

  const result = await processKnowledgeBatch({ limit: 1 });

  assert.equal(result.failed, 1);
  assert.equal(countRows("conversation_insights"), 0);
  assert.equal(countRows("auto_conversation_tags"), 0);
  assert.equal(countRows("conversation_similarities"), 0);
  assert.equal(getKnowledgeQueueStatus().running, 0);
  assert.equal(getKnowledgeQueueStatus().pending, 2);
});

test("knowledge model is disabled by default and does not dispatch fetch", async () => {
  useTempDb();
  const imported = seedSemanticPeers(1);
  const conversationId = imported.conversationIds[0];
  const conversation = (await import("../src/services/conversation-service.ts")).getConversation(conversationId);
  const fallback = {
    summary: "fallback",
    keyPoints: ["point"],
    tags: ["rule"],
    generator: "rule",
    generatorVersion: "rule-v1"
  };
  let calls = 0;

  const result = await enhanceKnowledgeWithModel(conversation, fallback, async () => {
    calls += 1;
    throw new Error("must not run");
  });

  assert.equal(getKnowledgeModelStatus().enabled, false);
  assert.equal(calls, 0);
  assert.equal(result, fallback);
});

test("enabled generative model merges only valid bounded JSON fields", async () => {
  useTempDb();
  const imported = seedSemanticPeers(1);
  const conversation = (await import("../src/services/conversation-service.ts")).getConversation(
    imported.conversationIds[0]
  );
  const fallback = {
    summary: "fallback summary",
    keyPoints: ["fallback point"],
    tags: ["fallback-tag"],
    generator: "rule",
    generatorVersion: "rule-v1"
  };
  process.env.AIHR_KNOWLEDGE_MODEL_ENABLED = "true";
  process.env.LLM_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.LLM_MODEL = "gemma4";

  const result = await enhanceKnowledgeWithModel(conversation, fallback, async (url) => {
    assert.equal(url, "http://127.0.0.1:11434/v1/chat/completions");
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "s".repeat(221),
              keyPoints: ["模型要点", "x".repeat(121)],
              tags: ["Gemma", "token=private-value"]
            })
          }
        }
      ]
    });
  });

  assert.equal(result.summary, fallback.summary);
  assert.deepEqual(result.keyPoints, ["模型要点"]);
  assert.deepEqual(result.tags, ["Gemma", "token=[redacted]"]);
  assert.equal(result.generator, "model");
  assert.equal(result.generatorVersion, "model:gemma4");
});

test("knowledge process route caps each heartbeat batch at ten jobs", async () => {
  useTempDb();
  importParsedConversations(
    Array.from({ length: 12 }, (_, index) => ({
      title: `Queue item ${index}`,
      sourcePlatform: "chatgpt",
      sourceUrl: `https://chatgpt.com/c/queue-${index}`,
      messages: [
        { role: "user", content: `How should local search queue item ${index} work?` },
        { role: "assistant", content: "Use deterministic local processing and SQLite." }
      ]
    })),
    "queue.json",
    "chatgpt"
  );

  const response = await knowledgeProcessRoute.POST(
    new Request("http://localhost/api/knowledge/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 999 })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.claimed, 10);
  assert.equal(body.queue.pending, 2);
});

test("worker backfills conversations created before the knowledge queue existed", async () => {
  useTempDb();
  const db = getDb();
  db.prepare(
    "INSERT INTO conversations (id, source_platform, title, imported_at) VALUES ('legacy', 'chatgpt', 'Legacy semantic search', ?)"
  ).run("2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, order_index) VALUES ('legacy-message', 'legacy', 'user', 'How does semantic recall work?', 0)"
  ).run();

  const result = await processKnowledgeBatch({ limit: 1 });

  assert.equal(result.backfilled, 1);
  assert.equal(result.completed, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM conversation_insights").get().count, 1);
});
