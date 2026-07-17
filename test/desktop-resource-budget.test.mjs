import test from "node:test";
import assert from "node:assert/strict";

const { evaluateBudget, summarizeSamples } = await import("../scripts/measure-desktop-idle.mjs");

test("resource sampler rejects over-budget idle samples", () => {
  assert.equal(evaluateBudget({ cpuAverage: 0.7, rssMb: 90, dbWakeups: 1, outboundRequests: 0 }).ok, false);
  assert.equal(evaluateBudget({ cpuAverage: 0.2, rssMb: 121, dbWakeups: 1, outboundRequests: 0 }).ok, false);
  assert.equal(evaluateBudget({ cpuAverage: 0.2, rssMb: 90, dbWakeups: 6, outboundRequests: 0 }).ok, false);
  assert.equal(evaluateBudget({ cpuAverage: 0.2, rssMb: 90, dbWakeups: 1, outboundRequests: 1 }).ok, false);
});

test("resource sampler accepts the specified idle budget", () => {
  assert.deepEqual(
    evaluateBudget({ cpuAverage: 0.2, rssMb: 100, dbWakeups: 3, outboundRequests: 0 }),
    {
      ok: true,
      thresholds: { cpuAverage: 0.5, rssMb: 120, dbWakeups: 5, outboundRequests: 0 },
      failures: []
    }
  );
});

test("sample summary averages CPU and uses peak combined RSS", () => {
  assert.deepEqual(
    summarizeSamples([
      { cpu: 0.1, rssMb: 80 },
      { cpu: 0.3, rssMb: 110 },
      { cpu: 0.2, rssMb: 90 }
    ]),
    { cpuAverage: 0.2, rssMb: 110 }
  );
});
