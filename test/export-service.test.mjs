import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { updateConversationMetadata } = await import("../src/services/conversation-service.ts");
const { exportConversationJson, exportConversationMarkdown } = await import("../src/services/export-service.ts");
const exportRoute = await import("../src/app/api/conversations/[id]/export/route.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-export-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

function seedConversation() {
  const result = importParsedConversations(
    [
      {
        title: "Export Regression",
        sourcePlatform: "qwen",
        sourceUrl: "https://www.qianwen.com/chat/export-regression",
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:05:00.000Z",
        summary: "Export summary",
        messages: [
          {
            role: "user",
            content: "First export message"
          },
          {
            role: "assistant",
            content: "Second export message"
          }
        ],
        tags: ["export"]
      }
    ],
    "export.json",
    "qwen"
  );

  updateConversationMetadata(result.conversationIds[0], ["export", "backup"], "Export note");
  return result.conversationIds[0];
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_API_TOKEN;
  delete process.env.AIHR_DB_PATH;
});

test("exports readable Markdown with metadata and ordered messages", () => {
  useTempDb();
  const conversationId = seedConversation();

  const markdown = exportConversationMarkdown(conversationId);

  assert.match(markdown, /^# Export Regression/m);
  assert.match(markdown, /- Platform: qwen/);
  assert.match(markdown, /- Source URL: https:\/\/www\.qianwen\.com\/chat\/export-regression/);
  assert.match(markdown, /- Tags: backup, export/);
  assert.match(markdown, /## Note\n\nExport note/);
  assert.ok(markdown.indexOf("### User") < markdown.indexOf("### Assistant"));
  assert.match(markdown, /First export message/);
  assert.match(markdown, /Second export message/);
});

test("exports JSON with metadata, note, tags, and message order", () => {
  useTempDb();
  const conversationId = seedConversation();

  const exported = exportConversationJson(conversationId);

  assert.equal(exported.title, "Export Regression");
  assert.equal(exported.sourcePlatform, "qwen");
  assert.equal(exported.sourceUrl, "https://www.qianwen.com/chat/export-regression");
  assert.deepEqual(exported.tags, ["backup", "export"]);
  assert.equal(exported.note, "Export note");
  assert.deepEqual(
    exported.messages.map((message) => message.content),
    ["First export message", "Second export message"]
  );
});

test("export route returns Markdown and JSON without a Next server", async () => {
  process.env.AIHR_API_TOKEN = "export-secret";
  useTempDb();
  const conversationId = seedConversation();

  const markdownResponse = await exportRoute.GET(
    new Request(`http://localhost/api/conversations/${conversationId}/export?format=markdown`, {
      headers: {
        "X-AIHR-API-Token": "export-secret"
      }
    }),
    { params: Promise.resolve({ id: conversationId }) }
  );
  const jsonResponse = await exportRoute.GET(
    new Request(`http://localhost/api/conversations/${conversationId}/export?format=json`, {
      headers: {
        "X-AIHR-API-Token": "export-secret"
      }
    }),
    { params: Promise.resolve({ id: conversationId }) }
  );

  assert.equal(markdownResponse.status, 200);
  assert.equal(markdownResponse.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.match(await markdownResponse.text(), /# Export Regression/);
  assert.equal(jsonResponse.status, 200);
  assert.equal((await jsonResponse.json()).title, "Export Regression");
});
