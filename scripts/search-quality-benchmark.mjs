import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("../test/path-alias-loader.mjs", import.meta.url);

const projectRoot = process.cwd();
const outputArgIndex = process.argv.indexOf("--output");
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;
const topKArgIndex = process.argv.indexOf("--top-k");
const topK = topKArgIndex >= 0 ? Number.parseInt(process.argv[topKArgIndex + 1] || "", 10) : 3;
const compareCurrent = process.argv.includes("--compare-current");

const previousEnv = {
  AIHR_DB_PATH: process.env.AIHR_DB_PATH,
  AIHR_EMBEDDING_PROVIDER: process.env.AIHR_EMBEDDING_PROVIDER,
  AIHR_EMBEDDING_MODEL: process.env.AIHR_EMBEDDING_MODEL,
  AIHR_EMBEDDING_BASE_URL: process.env.AIHR_EMBEDDING_BASE_URL,
  AIHR_EMBEDDING_API_KEY: process.env.AIHR_EMBEDDING_API_KEY
};

try {
  const { closeDb } = await import("../src/lib/db.ts");
  const {
    evaluateSearchQualityBenchmark,
    seedSearchBenchmarkCorpus
  } = await import("../src/services/search-quality-benchmark-service.ts");

  function restoreEmbeddingEnv(values) {
    for (const key of [
      "AIHR_EMBEDDING_PROVIDER",
      "AIHR_EMBEDDING_MODEL",
      "AIHR_EMBEDDING_BASE_URL",
      "AIHR_EMBEDDING_API_KEY"
    ]) {
      if (values[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = values[key];
      }
    }
  }

  function clearEmbeddingEnv() {
    delete process.env.AIHR_EMBEDDING_PROVIDER;
    delete process.env.AIHR_EMBEDDING_MODEL;
    delete process.env.AIHR_EMBEDDING_BASE_URL;
    delete process.env.AIHR_EMBEDDING_API_KEY;
  }

  function runScenario(scenario, configureEmbedding) {
    closeDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-search-benchmark-"));
    process.env.AIHR_DB_PATH = path.join(tempDir, "benchmark.sqlite");
    configureEmbedding();
    seedSearchBenchmarkCorpus();
    const report = evaluateSearchQualityBenchmark({ topK });
    closeDb();
    return {
      scenario: { ...scenario, dbPath: process.env.AIHR_DB_PATH },
      ...report
    };
  }

  const reports = [
    runScenario(
      { id: "local-offline", label: "Built-in offline semantic index" },
      clearEmbeddingEnv
    )
  ];

  if (compareCurrent) {
    reports.push(
      runScenario(
        {
          id: "current-config",
          label: "Current AIHR_EMBEDDING_* configuration"
        },
        () => restoreEmbeddingEnv(previousEnv)
      )
    );
  }

  const report = compareCurrent
    ? {
        generatedAt: new Date().toISOString(),
        topK,
        scenarios: reports.map((item) => ({
          scenario: item.scenario,
          metrics: item.metrics,
          modelCoverage: item.modelCoverage,
          cases: item.cases
        }))
      }
    : reports[0];

  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, body);
    console.log(`Search quality benchmark written to ${resolved}`);
  } else {
    process.stdout.write(body);
  }

  closeDb();
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
