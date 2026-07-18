import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { importParsedConversations } = await import("../src/services/import-service.ts");
const { processKnowledgeBatch } = await import("../src/services/knowledge-worker-service.ts");
const { getKnowledgeOrganization } = await import("../src/services/knowledge-organization-service.ts");
const { closeDb } = await import("../src/lib/db.ts");

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-knowledge-org-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
});

test("knowledge organization groups project clusters and reusable asset categories", async () => {
  useTempDb();
  importParsedConversations(
    [
      {
        title: "语义搜索升级",
        sourcePlatform: "chatgpt",
        sourceUrl: "https://chatgpt.com/c/org-semantic",
        messages: [
          { role: "user", content: "语义搜索为什么搜不到同义问题？" },
          { role: "assistant", content: "方案：补充 embedding 与 SQLite FTS 的混合检索，并增加回归测试。" }
        ]
      },
      {
        title: "桌面应用后台资源",
        sourcePlatform: "qwen",
        sourceUrl: "https://www.qianwen.com/chat/org-desktop",
        messages: [
          { role: "user", content: "托盘后台资源占用太高怎么排查？" },
          { role: "assistant", content: "建议检查 D5 idle 报告、daemon 唤醒和桌面应用配置。" }
        ]
      }
    ],
    "knowledge-org.json",
    "fixture"
  );
  await processKnowledgeBatch({ limit: 10 });

  const organization = getKnowledgeOrganization();
  assert.equal(organization.totals.conversations, 2);
  assert.equal(organization.totals.withInsight, 2);
  assert.ok(organization.projectClusters.some((cluster) => cluster.label === "语义搜索"));
  assert.ok(organization.projectClusters.some((cluster) => cluster.label === "桌面应用"));
  assert.ok(organization.assetCategories.find((category) => category.key === "problem")?.count >= 2);
  assert.ok(organization.assetCategories.find((category) => category.key === "solution")?.count >= 2);
  assert.ok(organization.assetCategories.find((category) => category.key === "operations")?.count >= 1);
});
