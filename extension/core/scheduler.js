(() => {
  const NAMES = Object.freeze({
    capture: "aihr_process_capture_queue",
    autoPilot: "aihr_background_autopilot",
    snapshotPrefix: "aihr_snapshot_"
  });
  const DELAYS = Object.freeze({
    capture: 5200,
    captureJitter: 3200,
    autoPilotInterval: 6 * 60 * 60 * 1000,
    autoPilotRetry: 15 * 60 * 1000,
    snapshotCooldown: 10 * 60 * 1000
  });
  const AUTO_PILOT_NEXT_KEY = "aihrAutoPilotNextAt";

  function createScheduler(options = {}) {
    const alarms = options.alarms;
    const storage = options.storage;
    const now = options.now || Date.now;
    const random = options.random || Math.random;

    function randomDelay(baseMs = DELAYS.capture, jitterMs = DELAYS.captureJitter) {
      return baseMs + Math.floor(random() * jitterMs);
    }

    function scheduleQueueStep(delayMs) {
      return alarms.create(NAMES.capture, { when: now() + Math.max(delayMs, 1000) });
    }

    function clearQueue() {
      return alarms.clear(NAMES.capture);
    }

    function scheduleQueueLease(leaseUntil) {
      return alarms.create(NAMES.capture, { when: leaseUntil });
    }

    async function scheduleAutoPilot(delayMs = DELAYS.autoPilotInterval) {
      const scheduledAt = now() + Math.max(delayMs, 60000);
      await storage.set({ [AUTO_PILOT_NEXT_KEY]: scheduledAt });
      await alarms.create(NAMES.autoPilot, { when: scheduledAt });
      return scheduledAt;
    }

    async function getAutoPilotNextAt() {
      const stored = await storage.get(AUTO_PILOT_NEXT_KEY);
      return Number(stored[AUTO_PILOT_NEXT_KEY]) || 0;
    }

    function setAutoPilotNextAt(nextAt) {
      return storage.set({ [AUTO_PILOT_NEXT_KEY]: nextAt });
    }

    function restoreAutoPilot(nextAt) {
      return alarms.create(NAMES.autoPilot, { when: nextAt });
    }

    async function clearAutoPilot() {
      await alarms.clear(NAMES.autoPilot);
      await storage.remove(AUTO_PILOT_NEXT_KEY);
    }

    function removeAutoPilotNextAt() {
      return storage.remove(AUTO_PILOT_NEXT_KEY);
    }

    function scheduleSnapshot(tabId, when) {
      return alarms.create(`${NAMES.snapshotPrefix}${tabId}`, { when });
    }

    function clearSnapshot(tabId) {
      return alarms.clear(`${NAMES.snapshotPrefix}${tabId}`);
    }

    function snapshotTabId(alarmName) {
      if (!alarmName.startsWith(NAMES.snapshotPrefix)) return null;
      const tabId = Number(alarmName.slice(NAMES.snapshotPrefix.length));
      return Number.isFinite(tabId) ? tabId : null;
    }

    return Object.freeze({
      names: NAMES,
      delays: DELAYS,
      random: () => random(),
      randomDelay,
      startupDelay: () => 3 * 60 * 1000 + Math.floor(random() * 3 * 60 * 1000),
      enabledDelay: () => 2 * 60 * 1000 + Math.floor(random() * 3 * 60 * 1000),
      retryUntil: () => new Date(now() + DELAYS.autoPilotRetry).toISOString(),
      scheduleQueueStep,
      scheduleQueueLease,
      clearQueue,
      scheduleAutoPilot,
      getAutoPilotNextAt,
      setAutoPilotNextAt,
      restoreAutoPilot,
      clearAutoPilot,
      removeAutoPilotNextAt,
      scheduleSnapshot,
      clearSnapshot,
      snapshotTabId,
      onAlarm: (listener) => alarms.onAlarm(listener)
    });
  }

  const chromeApi = globalThis.AIHR_CHROME_API;
  const defaultScheduler = chromeApi
    ? createScheduler({ alarms: chromeApi.alarms, storage: chromeApi.storage })
    : {};
  globalThis.AIHR_SCHEDULER = Object.freeze({ createScheduler, ...defaultScheduler });
})();
