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

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-import-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("skips duplicate source URLs without duplicating messages", () => {
  useTempDb();

  const conversation = {
    title: "Duplicate import conversation",
    sourcePlatform: "chatgpt",
    sourceUrl: "https://chatgpt.com/c/duplicate-regression",
    messages: [
      {
        role: "user",
        content: "Please remember the duplicate regression phrase."
      },
      {
        role: "assistant",
        content: "The duplicate regression phrase is safely indexed once."
      }
    ]
  };

  const first = importParsedConversations([conversation], "duplicate.json", "chatgpt");
  const second = importParsedConversations([conversation], "duplicate.json", "chatgpt");

  assert.equal(first.importedConversations, 1);
  assert.equal(first.importedMessages, 2);
  assert.equal(first.skippedDuplicates, 0);
  assert.equal(second.importedConversations, 0);
  assert.equal(second.importedMessages, 0);
  assert.equal(second.skippedDuplicates, 1);

  const db = getDb();
  const conversationCount = db.prepare("SELECT COUNT(*) AS count FROM conversations").get();
  const messageCount = db.prepare("SELECT COUNT(*) AS count FROM messages").get();

  assert.equal(conversationCount.count, 1);
  assert.equal(messageCount.count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM semantic_index").get().count, 2);
  assert.deepEqual(getKnowledgeQueueStatus(), {
    pending: 1,
    running: 0,
    completed: 0,
    failed: 0,
    total: 1
  });
});

test("merges appended messages into an existing source URL without replacing user metadata", () => {
  useTempDb();

  const sourceUrl = "https://chatgpt.com/c/incremental-merge";
  const first = importParsedConversations(
    [
      {
        title: "Incremental merge",
        sourcePlatform: "chatgpt",
        sourceUrl,
        tags: ["captured"],
        messages: [
          { role: "user", content: "How should incremental sync work?" },
          { role: "assistant", content: "Start with a stable source URL." }
        ]
      }
    ],
    "first.json",
    "chatgpt"
  );

  const db = getDb();
  const conversationId = first.conversationIds[0];
  db.prepare("UPDATE conversations SET remark = ? WHERE id = ?").run("Keep this remark", conversationId);
  db.prepare(
    "INSERT INTO notes (id, conversation_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("note-1", conversationId, "Keep this note", new Date().toISOString(), new Date().toISOString());

  const second = importParsedConversations(
    [
      {
        title: "Incremental merge updated title",
        sourcePlatform: "chatgpt",
        sourceUrl,
        tags: ["replacement-tag"],
        messages: [
          { role: "user", content: "How should incremental sync work?" },
          { role: "assistant", content: "Start with a stable source URL." },
          { role: "user", content: "And what happens next?" },
          { role: "assistant", content: "Append only the unseen tail and index it." }
        ]
      }
    ],
    "second.json",
    "chatgpt"
  );

  assert.equal(second.importedConversations, 0);
  assert.equal(second.importedMessages, 2);
  assert.equal(second.updatedConversations, 1);
  assert.equal(second.skippedDuplicates, 0);

  const messages = db
    .prepare("SELECT role, content, order_index FROM messages WHERE conversation_id = ? ORDER BY order_index")
    .all(conversationId);
  assert.deepEqual(
    messages.map((message) => [message.role, message.content, message.order_index]),
    [
      ["user", "How should incremental sync work?", 0],
      ["assistant", "Start with a stable source URL.", 1],
      ["user", "And what happens next?", 2],
      ["assistant", "Append only the unseen tail and index it.", 3]
    ]
  );

  const metadata = db
    .prepare(
      `SELECT c.remark, n.content AS note
       FROM conversations c
       LEFT JOIN notes n ON n.conversation_id = c.id
       WHERE c.id = ?`
    )
    .get(conversationId);
  assert.equal(metadata.remark, "Keep this remark");
  assert.equal(metadata.note, "Keep this note");

  const tags = db
    .prepare(
      `SELECT t.name
       FROM conversation_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.conversation_id = ?
       ORDER BY t.name`
    )
    .all(conversationId)
    .map((row) => row.name);
  assert.deepEqual(tags, ["captured"]);

  const indexedTail = db
    .prepare("SELECT COUNT(*) AS count FROM search_index WHERE conversation_id = ? AND content MATCH ?")
    .get(conversationId, '"unseen tail"');
  assert.equal(indexedTail.count, 1);
  const semanticTail = db
    .prepare("SELECT COUNT(*) AS count FROM semantic_index WHERE conversation_id = ? AND content LIKE ?")
    .get(conversationId, "%unseen tail%");
  assert.equal(semanticTail.count, 1);

  const third = importParsedConversations(
    [
      {
        title: "Incremental merge updated title",
        sourcePlatform: "chatgpt",
        sourceUrl,
        messages: [
          { role: "user", content: "How should incremental sync work?" },
          { role: "assistant", content: "Start with a stable source URL." },
          { role: "user", content: "And what happens next?" },
          { role: "assistant", content: "Append only the unseen tail and index it." }
        ]
      }
    ],
    "third.json",
    "chatgpt"
  );
  assert.equal(third.importedMessages, 0);
  assert.equal(third.updatedConversations, 0);
  assert.equal(third.skippedDuplicates, 1);
  assert.deepEqual(getKnowledgeQueueStatus(), {
    pending: 1,
    running: 0,
    completed: 1,
    failed: 0,
    total: 2
  });
});

test("merges from an existing tail anchor when a later snapshot gains leading context", () => {
  useTempDb();
  const sourceUrl = "https://chatgpt.com/c/shifted-snapshot";

  importParsedConversations(
    [
      {
        title: "Shifted snapshot",
        sourcePlatform: "chatgpt",
        sourceUrl,
        messages: [
          { role: "user", content: "Original question" },
          { role: "assistant", content: "Original answer" }
        ]
      }
    ],
    "first.json",
    "chatgpt"
  );

  const merged = importParsedConversations(
    [
      {
        title: "Shifted snapshot",
        sourcePlatform: "chatgpt",
        sourceUrl,
        messages: [
          { role: "system", content: "Context added by a newer extractor" },
          { role: "user", content: "Original question" },
          { role: "assistant", content: "Original answer" },
          { role: "user", content: "New follow-up" }
        ]
      }
    ],
    "second.json",
    "chatgpt"
  );

  assert.equal(merged.importedMessages, 1);
  assert.equal(merged.updatedConversations, 1);
  const contents = getDb()
    .prepare("SELECT content FROM messages ORDER BY order_index")
    .all()
    .map((row) => row.content);
  assert.deepEqual(contents, ["Original question", "Original answer", "New follow-up"]);
});
