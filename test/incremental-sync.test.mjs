import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);

const { selectIncrementalTargets } = await import("../src/capture/incremental-sync.ts");

test("stops incremental discovery after a consecutive known URL threshold", () => {
  const targets = [
    { platform: "chatgpt", url: "https://chatgpt.com/c/new-2", title: "new 2" },
    { platform: "chatgpt", url: "https://chatgpt.com/c/new-1", title: "new 1" },
    { platform: "chatgpt", url: "https://chatgpt.com/c/known-3", title: "known 3" },
    { platform: "chatgpt", url: "https://chatgpt.com/c/known-2", title: "known 2" },
    { platform: "chatgpt", url: "https://chatgpt.com/c/known-1", title: "known 1" },
    { platform: "chatgpt", url: "https://chatgpt.com/c/old-unseen", title: "too old" }
  ];

  const result = selectIncrementalTargets(targets, {
    knownUrls: new Set(targets.slice(2, 5).map((target) => target.url)),
    maxItems: 20,
    stopAfterKnown: 3
  });

  assert.deepEqual(result.targets.map((target) => target.url), [targets[0].url, targets[1].url]);
  assert.equal(result.scannedCount, 5);
  assert.equal(result.knownCount, 3);
  assert.equal(result.stopReason, "known_streak");
});

test("resets the known streak when a newer unknown URL is encountered", () => {
  const targets = [
    { platform: "qwen", url: "https://www.qianwen.com/chat/known-a", title: "known a" },
    { platform: "qwen", url: "https://www.qianwen.com/chat/new-a", title: "new a" },
    { platform: "qwen", url: "https://www.qianwen.com/chat/known-b", title: "known b" },
    { platform: "qwen", url: "https://www.qianwen.com/chat/known-c", title: "known c" }
  ];

  const result = selectIncrementalTargets(targets, {
    knownUrls: new Set([targets[0].url, targets[2].url, targets[3].url]),
    maxItems: 4,
    stopAfterKnown: 2
  });

  assert.deepEqual(result.targets.map((target) => target.url), [targets[1].url]);
  assert.equal(result.scannedCount, 4);
  assert.equal(result.stopReason, "known_streak");
});
