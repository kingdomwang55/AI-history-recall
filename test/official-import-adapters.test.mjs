import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importFile } = await import("../src/services/import-service.ts");
const { getDb, closeDb } = await import("../src/lib/db.ts");

function setupTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-official-import-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

async function importJson(fileName, value) {
  setupTempDb();
  const result = await importFile({
    fileName,
    mimeType: "application/json",
    content: JSON.stringify(value)
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  return { result, db: getDb() };
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("imports ChatGPT conversations.json mapping exports", async () => {
  const { result, db } = await importJson("conversations.json", [
    {
      id: "chatgpt-official-id",
      title: "Official ChatGPT Export",
      create_time: 1780000000,
      update_time: 1780000100,
      mapping: {
        root: { id: "root", message: null, children: ["m1"] },
        m2: {
          message: {
            author: { role: "assistant" },
            create_time: 1780000002,
            content: { content_type: "text", parts: ["Use the mapping transcript."] }
          }
        },
        m1: {
          message: {
            author: { role: "user" },
            create_time: 1780000001,
            content: { content_type: "text", parts: ["How do official exports import?"] }
          }
        }
      }
    }
  ]);

  assert.equal(result.adapter, "ChatGPT Adapter");
  assert.equal(result.importedMessages, 2);
  assert.equal(db.prepare("SELECT source_platform FROM conversations").get().source_platform, "chatgpt");
  assert.equal(
    db.prepare("SELECT content FROM messages ORDER BY order_index LIMIT 1").get().content,
    "How do official exports import?"
  );
});

test("imports Claude conversations with chat_messages", async () => {
  const { result, db } = await importJson("claude-conversations.json", [
    {
      uuid: "claude-official-id",
      name: "Claude Export",
      created_at: "2026-07-01T10:00:00Z",
      chat_messages: [
        { sender: "human", text: "Summarize the launch plan." },
        { sender: "assistant", text: "Ship the signed desktop build." }
      ]
    }
  ]);

  assert.equal(result.adapter, "Claude Adapter");
  assert.equal(result.importedMessages, 2);
  assert.equal(db.prepare("SELECT source_platform FROM conversations").get().source_platform, "claude");
});

test("imports DeepSeek exported history", async () => {
  const { result, db } = await importJson("deepseek-history.json", {
    conversations: [
      {
        conversation_id: "deepseek-official-id",
        title: "DeepSeek Export",
        platform: "deepseek",
        messages: [
          { role: "user", content: "Find the regression." },
          { role: "assistant", content: "The adapter now parses exported JSON." }
        ]
      }
    ]
  });

  assert.equal(result.adapter, "DeepSeek Adapter");
  assert.equal(result.importedMessages, 2);
  assert.equal(db.prepare("SELECT source_platform FROM conversations").get().source_platform, "deepseek");
});

test("imports Qwen exported sessions", async () => {
  const { result, db } = await importJson("qwen-export.json", {
    chats: [
      {
        chat_id: "qwen-official-id",
        title: "Qwen Export",
        source: "通义千问",
        history: [
          { role: "user", content: "生成项目复盘。" },
          { role: "assistant", content: "先整理关键决策和后续行动。" }
        ]
      }
    ]
  });

  assert.equal(result.adapter, "通义千问 Adapter");
  assert.equal(result.importedMessages, 2);
  assert.equal(db.prepare("SELECT source_platform FROM conversations").get().source_platform, "qwen");
});
