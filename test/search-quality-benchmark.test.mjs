import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { closeDb } = await import("../src/lib/db.ts");
const {
  evaluateSearchQualityBenchmark,
  seedSearchBenchmarkCorpus
} = await import("../src/services/search-quality-benchmark-service.ts");

function useTempDb() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-search-quality-test-"));
  process.env.AIHR_DB_PATH = path.join(dir, "test.sqlite");
  delete process.env.AIHR_EMBEDDING_PROVIDER;
  delete process.env.AIHR_EMBEDDING_MODEL;
  delete process.env.AIHR_EMBEDDING_BASE_URL;
  delete process.env.AIHR_EMBEDDING_API_KEY;
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_EMBEDDING_PROVIDER;
  delete process.env.AIHR_EMBEDDING_MODEL;
  delete process.env.AIHR_EMBEDDING_BASE_URL;
  delete process.env.AIHR_EMBEDDING_API_KEY;
});

test("search quality benchmark reports deterministic local baseline metrics", () => {
  useTempDb();
  const seeded = seedSearchBenchmarkCorpus();
  const report = evaluateSearchQualityBenchmark({ topK: 3 });

  assert.equal(seeded.importedConversations, 5);
  assert.equal(report.metrics.totalCases, 5);
  assert.ok(report.metrics.hitRateAtK >= 0.8);
  assert.ok(report.metrics.meanReciprocalRank >= 0.6);
  assert.equal(report.modelCoverage[0].model, "aihr-local-hash-v1");
  assert.equal(report.modelCoverage[0].messages, 10);
  assert.ok(report.cases.every((item) => item.rank === null || item.rank >= 1));
});

test("search quality benchmark script is wired as a package command", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const script = fs.readFileSync(new URL("../scripts/search-quality-benchmark.mjs", import.meta.url), "utf8");

  assert.equal(pkg.scripts["search:benchmark"], "node scripts/search-quality-benchmark.mjs");
  assert.match(script, /aihr-search-benchmark-/);
  assert.match(script, /--compare-current/);
  assert.match(script, /clearEmbeddingEnv/);
});
