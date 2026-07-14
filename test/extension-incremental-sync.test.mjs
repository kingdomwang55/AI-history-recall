import test from "node:test";
import assert from "node:assert/strict";

await import("../extension/incremental-sync.js");

test("extension incremental tracker stops at known streak and emits only unknown targets", () => {
  const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker({
    mode: "incremental",
    knownUrls: ["known-1", "known-2", "known-3"],
    maxItems: 20,
    stopAfterKnown: 3
  });

  assert.deepEqual(tracker.consider({ url: "new-1" }), { include: true, stop: false });
  assert.deepEqual(tracker.consider({ url: "known-1" }), { include: false, stop: false });
  assert.deepEqual(tracker.consider({ url: "known-2" }), { include: false, stop: false });
  assert.deepEqual(tracker.consider({ url: "known-3" }), { include: false, stop: true });
  assert.deepEqual(tracker.stats(), {
    scannedCount: 4,
    knownCount: 3,
    consecutiveKnown: 3,
    stopped: true,
    stopReason: "known_streak"
  });
});

test("extension tracker keeps full capture behavior unchanged", () => {
  const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker({ mode: "full", maxItems: 2 });
  assert.deepEqual(tracker.consider({ url: "a" }), { include: true, stop: false });
  assert.deepEqual(tracker.consider({ url: "b" }), { include: true, stop: true });
  assert.equal(tracker.stats().stopReason, "max_items");
});

test("known DeepSeek pinned conversations do not hide newer dated groups", () => {
  const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker({
    mode: "incremental",
    knownUrls: ["pinned-1", "pinned-2", "known-1", "known-2"],
    maxItems: 20,
    stopAfterKnown: 2
  });

  assert.deepEqual(tracker.consider({ url: "pinned-1", ignoreKnownStreak: true }), {
    include: false,
    stop: false
  });
  assert.deepEqual(tracker.consider({ url: "pinned-2", ignoreKnownStreak: true }), {
    include: false,
    stop: false
  });
  assert.deepEqual(tracker.consider({ url: "yesterday-new" }), { include: true, stop: false });
  assert.deepEqual(tracker.consider({ url: "known-1" }), { include: false, stop: false });
  assert.deepEqual(tracker.consider({ url: "known-2" }), { include: false, stop: true });
  assert.deepEqual(tracker.stats(), {
    scannedCount: 3,
    knownCount: 2,
    consecutiveKnown: 2,
    stopped: true,
    stopReason: "known_streak"
  });
});

test("conversation activity waits for the existing snapshot cooldown instead of being dropped", () => {
  const now = 1_000_000;
  const lastCapturedAt = now - 60_000;
  const nextAt = globalThis.AIHR_INCREMENTAL_SYNC.nextSnapshotAt({
    now,
    lastCapturedAt,
    cooldownMs: 10 * 60_000,
    minDelayMs: 20_000,
    jitterMs: 25_000,
    random: () => 0
  });

  assert.equal(nextAt, lastCapturedAt + 10 * 60_000);
});

test("conversation activity uses a randomized quiet delay when no cooldown is active", () => {
  const nextAt = globalThis.AIHR_INCREMENTAL_SYNC.nextSnapshotAt({
    now: 1_000_000,
    lastCapturedAt: 0,
    cooldownMs: 10 * 60_000,
    minDelayMs: 20_000,
    jitterMs: 25_000,
    random: () => 0.5
  });

  assert.equal(nextAt, 1_032_500);
});
