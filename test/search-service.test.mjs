import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { HIGHLIGHT_END, HIGHLIGHT_START, searchConversations } = await import("../src/services/search-service.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-search-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

function seedSearchConversation() {
  return importParsedConversations(
    [
      {
        title: "Luminous Search Regression",
        sourcePlatform: "gemini",
        sourceUrl: "https://gemini.google.com/app/search-regression",
        messages: [
          {
            role: "user",
            content: "Find the phrase nebula-rutabaga in this imported message."
          },
          {
            role: "assistant",
            content: "Fallback matching should also find the plain title and content."
          }
        ],
        tags: ["regression"]
      }
    ],
    "search.json",
    "gemini"
  );
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("returns imported conversations through the FTS index", () => {
  useTempDb();
  const imported = seedSearchConversation();

  const results = searchConversations({
    query: "nebula-rutabaga",
    sort: "newest"
  });

  assert.equal(imported.importedConversations, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].conversationId, imported.conversationIds[0]);
  assert.equal(results[0].title, "Luminous Search Regression");
  assert.equal(results[0].sourcePlatform, "gemini");
  assert.match(results[0].snippet, /nebula-rutabaga/);
});

test("falls back to recent results when a query has no searchable terms", () => {
  useTempDb();
  const imported = seedSearchConversation();

  const results = searchConversations({
    query: "\"",
    sort: "newest"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].conversationId, imported.conversationIds[0]);
  assert.equal(results[0].title, "Luminous Search Regression");
  assert.equal(results[0].sourcePlatform, "gemini");
  assert.equal(typeof results[0].snippet, "string");
});

test("returns the expected search result shape", () => {
  useTempDb();
  seedSearchConversation();

  const [result] = searchConversations({
    query: "plain",
    sort: "newest"
  });

  assert.ok(result.conversationId);
  assert.ok(result.title);
  assert.equal(result.sourcePlatform, "gemini");
  assert.equal(typeof result.snippet, "string");
  assert.ok(
    result.snippet.includes("plain") ||
      result.snippet.includes(HIGHLIGHT_START) ||
      result.snippet.includes(HIGHLIGHT_END)
  );
});
