(() => {
  const STORAGE_KEY = "aihrActiveRun";
  const DEFAULT_LEASE_MS = 180000;

  function createQueue(storage, options = {}) {
    const now = options.now || Date.now;
    const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;

    async function read() {
      return (await storage.get()) || null;
    }

    async function write(state) {
      await storage.set(state);
      return state;
    }

    async function update(patch) {
      return write({ ...((await read()) || {}), ...patch });
    }

    async function restore(at = now()) {
      const state = await read();
      if (!state || state.status !== "running") return state;

      const explicitLease = Number(state.leaseUntil) || 0;
      const startedAt = state.processingStartedAt ? Date.parse(state.processingStartedAt) : 0;
      const leaseUntil = explicitLease || (startedAt ? startedAt + leaseMs : 0);
      if (!leaseUntil) {
        if (state.phase !== "capturing" || !state.processing) return state;
      } else if (leaseUntil > at) {
        return explicitLease ? state : write({ ...state, leaseUntil });
      }

      if (state.phase === "capturing") {
        return write({
          ...state,
          processing: false,
          processingStartedAt: null,
          leaseUntil: null,
          currentTarget: null
        });
      }

      return write({ ...state, status: "pending", leaseUntil: null });
    }

    async function clear() {
      await storage.remove();
    }

    return Object.freeze({ read, write, update, restore, clear });
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
