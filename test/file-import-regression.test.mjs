import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importFile } = await import("../src/services/import-service.ts");
const { getDb } = await import("../src/lib/db.ts");

function closeDb() {
  if (globalThis.aiHistoryRecallDb) {
    globalThis.aiHistoryRecallDb.close();
    delete globalThis.aiHistoryRecallDb;
  }
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

for (const fileName of ["sample-conversation.txt", "sample-conversation.md", "sample-conversations.json"]) {
  test(`imports and indexes the real ${path.extname(fileName)} example`, async () => {
    closeDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-file-import-test-"));
    process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
    const content = fs.readFileSync(path.join(process.cwd(), "examples", fileName), "utf8");

    const result = await importFile({ fileName, content });
    assert.equal(result.ok, true);
    assert.ok(result.importedConversations > 0);
    assert.ok(result.importedMessages > 0);

    const db = getDb();
    const messages = db.prepare("SELECT COUNT(*) AS count FROM messages").get().count;
    const indexed = db.prepare("SELECT COUNT(*) AS count FROM search_index").get().count;
    assert.equal(indexed, messages);
  });
}
