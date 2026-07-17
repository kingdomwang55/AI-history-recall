import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { deleteConversation, updateConversationMetadata } = await import("../src/services/conversation-service.ts");
const { reindexSearch } = await import("../src/services/reindex-service.ts");
const { getDb } = await import("../src/lib/db.ts");
const conversationRoute = await import("../src/app/api/conversations/[id]/route.ts");
const reindexRoute = await import("../src/app/api/search/reindex/route.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-management-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

function seedConversation() {
  const result = importParsedConversations(
    [
      {
        title: "Management Regression",
        sourcePlatform: "chatgpt",
        sourceUrl: "https://chatgpt.com/c/management-regression",
        messages: [
          {
            role: "user",
            content: "Please keep the management regression phrase."
          },
          {
            role: "assistant",
            content: "The management regression phrase should be indexed."
          }
        ],
        tags: ["management"]
      }
    ],
    "management.json",
    "chatgpt"
  );

  updateConversationMetadata(result.conversationIds[0], ["management", "cleanup"], "Local management note");
  return result.conversationIds[0];
}

function countRows(table, where = "", params = []) {
  const db = getDb();
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params).count;
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_API_TOKEN;
  delete process.env.AIHR_DB_PATH;
});

test("deleteConversation removes canonical and derived conversation data", () => {
  useTempDb();
  const conversationId = seedConversation();

  assert.equal(deleteConversation(conversationId).deleted, true);
  assert.equal(countRows("conversations", "WHERE id = ?", [conversationId]), 0);
  assert.equal(countRows("messages", "WHERE conversation_id = ?", [conversationId]), 0);
  assert.equal(countRows("conversation_tags", "WHERE conversation_id = ?", [conversationId]), 0);
  assert.equal(countRows("notes", "WHERE conversation_id = ?", [conversationId]), 0);
  assert.equal(countRows("search_index", "WHERE conversation_id = ?", [conversationId]), 0);
  assert.equal(countRows("semantic_index", "WHERE conversation_id = ?", [conversationId]), 0);
  assert.equal(countRows("knowledge_jobs", "WHERE conversation_id = ?", [conversationId]), 0);
});

test("metadata edits do not enqueue new knowledge work", () => {
  useTempDb();
  const conversationId = seedConversation();
  const before = countRows("knowledge_jobs");

  updateConversationMetadata(conversationId, ["manual-only"], "Metadata should not alter the transcript fingerprint");

  assert.equal(countRows("knowledge_jobs"), before);
});

test("reindexSearch rebuilds FTS and semantic rows from canonical messages", () => {
  useTempDb();
  seedConversation();
  const db = getDb();

  db.prepare("DELETE FROM search_index").run();
  db.prepare("DELETE FROM semantic_index").run();
  assert.equal(countRows("search_index"), 0);
  assert.equal(countRows("semantic_index"), 0);

  const result = reindexSearch();

  assert.equal(result.indexedMessages, 2);
  assert.equal(result.indexedSemanticMessages, 2);
  assert.equal(countRows("search_index"), 2);
  assert.equal(countRows("semantic_index"), 2);
});

test("management write routes require the shared API token", async () => {
  process.env.AIHR_API_TOKEN = "management-secret";
  useTempDb();
  const conversationId = seedConversation();

  const missingDelete = await conversationRoute.DELETE(
    new Request(`http://localhost/api/conversations/${conversationId}`, {
      method: "DELETE"
    }),
    { params: Promise.resolve({ id: conversationId }) }
  );
  const missingReindex = await reindexRoute.POST(
    new Request("http://localhost/api/search/reindex", {
      method: "POST"
    })
  );

  assert.equal(missingDelete.status, 401);
  assert.equal(missingReindex.status, 401);
});

test("management write routes accept the shared API token", async () => {
  process.env.AIHR_API_TOKEN = "management-secret";
  useTempDb();
  const conversationId = seedConversation();

  const reindexResponse = await reindexRoute.POST(
    new Request("http://localhost/api/search/reindex", {
      method: "POST",
      headers: {
        "X-AIHR-API-Token": "management-secret"
      }
    })
  );
  const deleteResponse = await conversationRoute.DELETE(
    new Request(`http://localhost/api/conversations/${conversationId}`, {
      method: "DELETE",
      headers: {
        "X-AIHR-API-Token": "management-secret"
      }
    }),
    { params: Promise.resolve({ id: conversationId }) }
  );

  assert.equal(reindexResponse.status, 200);
  assert.equal((await reindexResponse.json()).indexedMessages, 2);
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).deleted, true);
});
