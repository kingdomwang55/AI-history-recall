import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { getDb } = await import("../src/lib/db.ts");
const { getSimilarConversations, replaceSimilarConversations } = await import(
  "../src/services/similarity-service.ts"
);

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-similarity-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

function seedConversations() {
  const imported = importParsedConversations(
    [
      {
        title: "语义搜索升级",
        sourcePlatform: "chatgpt",
        sourceUrl: "https://chatgpt.com/c/semantic-search",
        messages: [
          { role: "user", content: "如何用 embedding 和 SQLite 实现语义搜索与混合召回？" },
          { role: "assistant", content: "组合全文检索和向量相似度，对候选结果归一化后排序。" }
        ]
      },
      {
        title: "向量召回方案",
        sourcePlatform: "gemini",
        sourceUrl: "https://gemini.google.com/app/vector-recall",
        messages: [
          { role: "user", content: "设计本地向量检索，让不同措辞的问题也能互相召回。" },
          { role: "assistant", content: "使用 embedding 余弦相似度，再与关键词搜索合并成混合检索。" }
        ]
      },
      {
        title: "番茄炒蛋",
        sourcePlatform: "qwen",
        sourceUrl: "https://qianwen.com/c/cooking",
        messages: [
          { role: "user", content: "晚餐怎么做番茄炒蛋？" },
          { role: "assistant", content: "鸡蛋炒熟盛出，再加入番茄和少量盐。" }
        ]
      }
    ],
    "similarity.json",
    "fixture"
  );
  return {
    semanticSearch: imported.conversationIds[0],
    vectorRecall: imported.conversationIds[1],
    cooking: imported.conversationIds[2]
  };
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("semantic peer ranks above an unrelated conversation", () => {
  useTempDb();
  const ids = seedConversations();

  replaceSimilarConversations(ids.semanticSearch, "hash-1");
  const similar = getSimilarConversations(ids.semanticSearch, 2);

  assert.equal(similar[0].conversationId, ids.vectorRecall);
  assert.ok(similar[0].score >= 0.28);
  assert.ok(similar.every((item) => item.conversationId !== ids.cooking));
});

test("reprocessing replaces stale normalized edges", () => {
  useTempDb();
  const ids = seedConversations();

  replaceSimilarConversations(ids.semanticSearch, "old");
  replaceSimilarConversations(ids.semanticSearch, "new");
  const edges = getSimilarConversations(ids.semanticSearch, 10);
  const stored = getDb()
    .prepare(
      "SELECT left_conversation_id, right_conversation_id, fingerprint FROM conversation_similarities"
    )
    .all();

  assert.ok(edges.length > 0);
  assert.ok(edges.every((edge) => edge.fingerprint === "new"));
  assert.ok(stored.every((edge) => edge.left_conversation_id < edge.right_conversation_id));
});

test("conversation vectors are reused while unchanged", () => {
  useTempDb();
  const ids = seedConversations();
  replaceSimilarConversations(ids.semanticSearch, "hash-1");
  const db = getDb();
  const before = db.prepare("SELECT conversation_id, fingerprint, updated_at FROM conversation_vectors ORDER BY conversation_id").all();

  replaceSimilarConversations(ids.semanticSearch, "hash-1");
  const after = db.prepare("SELECT conversation_id, fingerprint, updated_at FROM conversation_vectors ORDER BY conversation_id").all();

  assert.equal(before.length, 3);
  assert.deepEqual(after, before);
});

test("high vector score without lexical or tag evidence is excluded", () => {
  useTempDb();
  const ids = seedConversations();
  const unrelated = importParsedConversations(
    [
      {
        title: "VPS 供应商评估",
        sourcePlatform: "gemini",
        sourceUrl: "https://gemini.google.com/app/vps-vendors",
        messages: [
          { role: "user", content: "请专业分析不同海外主机供应商的付款方式、售后服务和风险。" },
          { role: "assistant", content: "建议根据预算、线路、工单响应时间和退款政策逐项比较。" }
        ]
      }
    ],
    "unrelated.json",
    "gemini"
  ).conversationIds[0];

  replaceSimilarConversations(ids.semanticSearch, "hash-1");

  assert.ok(getSimilarConversations(ids.semanticSearch, 10).every((item) => item.conversationId !== unrelated));
});
