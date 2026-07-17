import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);

const { generateRuleInsight } = await import("../src/services/knowledge-rule-service.ts");

const conversationFixture = {
  id: "conversation-1",
  sourcePlatform: "chatgpt",
  title: "升级语义搜索",
  createdAt: null,
  updatedAt: null,
  importedAt: "2026-01-01T00:00:00.000Z",
  summary: null,
  rawFileName: "fixture.json",
  sourceUrl: null,
  tags: [],
  note: "",
  messages: [
    {
      id: "m1",
      conversationId: "conversation-1",
      role: "user",
      content: "如何升级语义搜索，让 SQLite 全文检索也能召回表达不同但含义相近的历史对话？",
      createdAt: null,
      orderIndex: 0
    },
    {
      id: "m2",
      conversationId: "conversation-1",
      role: "assistant",
      content: "先保留 SQLite FTS 作为精确召回，再用 embedding 向量补充语义候选。api_key=super-secret-value",
      createdAt: null,
      orderIndex: 1
    },
    {
      id: "m3",
      conversationId: "conversation-1",
      role: "assistant",
      content: "最终建议采用混合检索：归一化关键词与向量分数，合并去重后排序。默认本地规则可工作，外部 embedding 模型保持可选。",
      createdAt: null,
      orderIndex: 2
    }
  ]
};

test("rule insight captures the problem and final conclusion", () => {
  const result = generateRuleInsight(conversationFixture);

  assert.match(result.summary, /语义搜索/);
  assert.match(result.summary, /混合检索/);
  assert.ok(result.summary.length <= 220);
  assert.ok(result.keyPoints.length > 0 && result.keyPoints.length <= 5);
  assert.equal(result.generator, "rule");
});

test("rule tags are bounded normalized and deterministic", () => {
  const first = generateRuleInsight(conversationFixture);
  const second = generateRuleInsight(conversationFixture);

  assert.deepEqual(first, second);
  assert.ok(first.tags.length <= 8);
  assert.equal(new Set(first.tags.map((tag) => tag.toLocaleLowerCase())).size, first.tags.length);
  assert.ok(first.tags.includes("语义搜索"));
  assert.ok(first.tags.includes("SQLite"));
});

test("generated knowledge redacts secrets and remains bounded for long content", () => {
  const result = generateRuleInsight({
    ...conversationFixture,
    messages: conversationFixture.messages.map((message) => ({
      ...message,
      content: `${message.content} Bearer abcdefghijklmnopqrstuvwxyz ${"detail ".repeat(100)}`
    }))
  });
  const output = JSON.stringify(result);

  assert.doesNotMatch(output, /super-secret-value|abcdefghijklmnopqrstuvwxyz/);
  assert.ok(result.summary.length <= 220);
  assert.ok(result.keyPoints.every((point) => point.length <= 120));
  assert.ok(result.tags.every((tag) => tag.length <= 32));
});
