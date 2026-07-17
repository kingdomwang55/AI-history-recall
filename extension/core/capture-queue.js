(() => {
  const STORAGE_KEY = "aihrActiveRun";
  const DEFAULT_LEASE_MS = 180000;
  const DEFAULT_DELAY_MS = 5200;
  const DEFAULT_JITTER_MS = 3200;

  function createQueue(storage, options = {}) {
    const now = options.now || Date.now;
    const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;
    const tokenFactory = options.tokenFactory || (() => globalThis.crypto.randomUUID());
    let defaultDelayMs = options.defaultDelayMs || DEFAULT_DELAY_MS;
    let defaultJitterMs = options.defaultJitterMs || DEFAULT_JITTER_MS;
    let armLease = options.armLease || (() => undefined);
    let identity = {
      extensionVersion: options.extensionVersion,
      extensionBuildId: options.extensionBuildId
    };
    let active = null;
    let controller;

    function withIdentity(state, touch = false) {
      if (!state) return null;
      return {
        ...state,
        ...(identity.extensionVersion ? { extensionVersion: identity.extensionVersion } : {}),
        ...(identity.extensionBuildId ? { extensionBuildId: identity.extensionBuildId } : {}),
        ...(touch ? { updatedAt: new Date(now()).toISOString() } : {})
      };
    }

    async function persist(state) {
      active = withIdentity(state, true);
      await storage.set(active);
      return active;
    }

    async function load() {
      active = withIdentity((await storage.get()) || null);
      return active;
    }

    function snapshot() {
      return active;
    }

    async function current() {
      return active || load();
    }

    function configure(configuration = {}) {
      identity = {
        extensionVersion: configuration.extensionVersion || identity.extensionVersion,
        extensionBuildId: configuration.extensionBuildId || identity.extensionBuildId
      };
      defaultDelayMs = configuration.defaultDelayMs || defaultDelayMs;
      defaultJitterMs = configuration.defaultJitterMs || defaultJitterMs;
      armLease = configuration.armLease || armLease;
      if (active) active = withIdentity(active);
      return controller;
    }

    function start(state) {
      return persist(state);
    }

    async function patch(changes) {
      return persist({ ...((await current()) || {}), ...changes });
    }

    async function initialize(targets, transitionOptions = {}) {
      const state = (await current()) || {};
      if (!targets.length) {
        return persist({
          ...state,
          phase: "completed",
          status: "completed",
          queue: [],
          nextIndex: 0,
          totalTargets: 0,
          processing: false,
          processingToken: null
        });
      }

      const queuePlatformCounts = targets.reduce((counts, target) => {
        const platform = target?.platform || "unknown";
        counts[platform] = (counts[platform] || 0) + 1;
        return counts;
      }, {});
      return persist({
        ...state,
        phase: "capturing",
        queue: targets,
        queuePlatformCounts,
        currentTarget: null,
        discoveryProgress: null,
        nextIndex: 0,
        totalTargets: targets.length,
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null,
        options: {
          pageDelayMs: transitionOptions.pageDelayMs || defaultDelayMs,
          pageJitterMs: transitionOptions.pageJitterMs || defaultJitterMs
        }
      });
    }

    async function resume() {
      const state = await current();
      const queue = Array.isArray(state?.queue) ? state.queue : [];
      const nextIndex = Number(state?.nextIndex) || 0;
      if (!state || queue.length === 0 || nextIndex >= queue.length) {
        throw new Error("No resumable capture queue.");
      }
      return persist({
        ...state,
        status: "running",
        phase: "capturing",
        stopRequested: false,
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null
      });
    }

    function sameTarget(left, right) {
      return (
        left?.platform === right?.platform &&
        left?.url === right?.url &&
        left?.title === right?.title
      );
    }

    function matchesClaim(state, claim) {
      const queue = Array.isArray(state?.queue) ? state.queue : [];
      const targetIndex = Number.isInteger(claim?.targetIndex) ? claim.targetIndex : -1;
      const target = queue[targetIndex];
      return Boolean(
        state?.processing &&
          typeof claim?.token === "string" &&
          claim.token &&
          state.processingToken === claim.token &&
          state.nextIndex === targetIndex &&
          sameTarget(target, claim.target) &&
          sameTarget(state.currentTarget, claim.target)
      );
    }

    function completionResult(stale, snapshot) {
      return { stale, applied: !stale, snapshot };
    }

    async function claim() {
      const state = await current();
      const queue = Array.isArray(state?.queue) ? state.queue : [];
      const nextIndex = Number(state?.nextIndex) || 0;
      const target = queue[nextIndex];
      if (
        !state ||
        state.status !== "running" ||
        state.phase !== "capturing" ||
        state.processing ||
        !target
      ) {
        return null;
      }

      const claimedAt = now();
      const token = tokenFactory();
      if (typeof token !== "string" || !token) throw new Error("Capture claim token must be a non-empty string.");
      const claimed = await persist({
        ...state,
        processing: true,
        processingStartedAt: new Date(claimedAt).toISOString(),
        processingToken: token,
        leaseUntil: claimedAt + leaseMs,
        currentTarget: {
          platform: target.platform,
          title: target.title,
          url: target.url,
          index: nextIndex + 1,
          total: queue.length
        }
      });
      await armLease(claimed.leaseUntil);
      return { token, target, targetIndex: nextIndex, snapshot: claimed };
    }

    async function succeed(claim, data) {
      const state = await load();
      if (!matchesClaim(state, claim)) return completionResult(true, state);

      const queue = Array.isArray(state?.queue) ? state.queue : [];
      const nextIndex = claim.targetIndex;
      const target = queue[nextIndex];

      const imported = data?.imported || {};
      const platformResult = state.platformResults?.[target.platform] || {};
      const snapshot = await persist({
        ...state,
        processed: (state.processed || 0) + 1,
        nextIndex: nextIndex + 1,
        importedConversations: (state.importedConversations || 0) + (imported.importedConversations || 0),
        importedMessages: (state.importedMessages || 0) + (imported.importedMessages || 0),
        skippedDuplicates: (state.skippedDuplicates || 0) + (imported.skippedDuplicates || 0),
        platformResults: {
          ...(state.platformResults || {}),
          [target.platform]: {
            newConversations: (platformResult.newConversations || 0) + (imported.importedConversations || 0),
            newMessages: (platformResult.newMessages || 0) + (imported.importedMessages || 0)
          }
        },
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null,
        currentTarget: null
      });
      return completionResult(false, snapshot);
    }

    async function fail(claim, error) {
      const state = await load();
      if (!matchesClaim(state, claim)) return completionResult(true, state);

      const queue = Array.isArray(state?.queue) ? state.queue : [];
      const nextIndex = claim.targetIndex;
      const target = queue[nextIndex];

      const snapshot = await persist({
        ...state,
        processed: (state.processed || 0) + 1,
        nextIndex: nextIndex + 1,
        failures: [
          ...(state.failures || []),
          {
            platform: target.platform,
            url: target.url,
            title: target.title,
            error: typeof error?.message === "string" ? error.message : "Capture failed."
          }
        ].slice(-80),
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null,
        currentTarget: null
      });
      return completionResult(false, snapshot);
    }

    function requestStop() {
      return patch({ stopRequested: true });
    }

    function stop() {
      return patch({
        status: "stopped",
        phase: "stopped",
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null
      });
    }

    function complete() {
      return patch({
        status: "completed",
        phase: "completed",
        processing: false,
        processingStartedAt: null,
        processingToken: null,
        leaseUntil: null,
        currentTarget: null
      });
    }

    async function restore(at = now()) {
      const state = await load();
      if (!state || state.status !== "running") return state;

      const explicitLease = Number(state.leaseUntil) || 0;
      const startedAt = state.processingStartedAt ? Date.parse(state.processingStartedAt) : 0;
      const leaseUntil = explicitLease || (startedAt ? startedAt + leaseMs : 0);
      if (!leaseUntil) {
        if (state.phase !== "capturing" || !state.processing) return state;
      } else if (leaseUntil > at) {
        return explicitLease ? state : persist({ ...state, leaseUntil });
      }

      if (state.phase === "capturing") {
        return persist({
          ...state,
          processing: false,
          processingStartedAt: null,
          processingToken: null,
          leaseUntil: null,
          currentTarget: null
        });
      }

      return persist({ ...state, status: "pending", processingToken: null, leaseUntil: null });
    }

    async function clear() {
      active = null;
      await storage.remove();
    }

    controller = Object.freeze({
      configure,
      snapshot,
      load,
      read: load,
      start,
      write: start,
      patch,
      update: patch,
      initialize,
      resume,
      claim,
      succeed,
      fail,
      requestStop,
      stop,
      complete,
      restore,
      clear
    });
    return controller;
  }

  const chromeStorage = globalThis.AIHR_CHROME_API?.storage;
  const defaultStorage = chromeStorage
    ? {
        async get() {
          const stored = await chromeStorage.get(STORAGE_KEY);
          return stored[STORAGE_KEY] || null;
        },
        set: (state) => chromeStorage.set({ [STORAGE_KEY]: state }),
        remove: () => chromeStorage.remove(STORAGE_KEY)
      }
    : null;
  const defaultQueue = defaultStorage ? createQueue(defaultStorage) : {};

  globalThis.AIHR_CAPTURE_QUEUE = Object.freeze({
    createQueue,
    storageKey: STORAGE_KEY,
    leaseMs: DEFAULT_LEASE_MS,
    ...defaultQueue
  });
})();
