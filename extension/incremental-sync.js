(function installIncrementalSync(global) {
  function createTracker(options = {}) {
    const incremental = options.mode === "incremental";
    const knownUrls = new Set(Array.isArray(options.knownUrls) ? options.knownUrls : []);
    const maxItems = Math.min(Math.max(Math.trunc(Number(options.maxItems) || 50), 1), 200);
    const stopAfterKnown = Math.min(Math.max(Math.trunc(Number(options.stopAfterKnown) || 10), 1), 50);
    let scannedCount = 0;
    let knownCount = 0;
    let consecutiveKnown = 0;
    let stopped = false;
    let stopReason = null;

    return {
      consider(target) {
        if (stopped || !target?.url) return { include: false, stop: stopped };

        if (incremental && knownUrls.has(target.url) && target.ignoreKnownStreak === true) {
          return { include: false, stop: false };
        }

        scannedCount += 1;

        if (incremental && knownUrls.has(target.url)) {
          knownCount += 1;
          consecutiveKnown += 1;
          if (consecutiveKnown >= stopAfterKnown) {
            stopped = true;
            stopReason = "known_streak";
          }
          return { include: false, stop: stopped };
        }

        consecutiveKnown = 0;
        if (scannedCount >= maxItems) {
          stopped = true;
          stopReason = "max_items";
        }
        return { include: true, stop: stopped };
      },
      stats() {
        return { scannedCount, knownCount, consecutiveKnown, stopped, stopReason };
      }
    };
  }

  function nextSnapshotAt(options = {}) {
    const now = Number(options.now) || Date.now();
    const lastCapturedAt = Math.max(Number(options.lastCapturedAt) || 0, 0);
    const cooldownMs = Math.max(Number(options.cooldownMs) || 0, 0);
    const minDelayMs = Math.max(Number(options.minDelayMs) || 0, 0);
    const jitterMs = Math.max(Number(options.jitterMs) || 0, 0);
    const random = typeof options.random === "function" ? options.random : Math.random;
    const quietDelayAt = now + minDelayMs + Math.floor(random() * jitterMs);
    const cooldownAt = lastCapturedAt > 0 ? lastCapturedAt + cooldownMs : 0;
    return Math.max(quietDelayAt, cooldownAt);
  }

  global.AIHR_INCREMENTAL_SYNC = { createTracker, nextSnapshotAt };
})(globalThis);
