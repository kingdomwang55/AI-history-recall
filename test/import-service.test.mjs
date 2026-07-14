import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { getDb } = await import("../src/lib/db.ts");

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
});
