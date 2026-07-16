(() => {
  const adapters = new Map();
  const requiredMethods = ["matches", "discover", "extract", "diagnostics"];

  function register(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id) {
      throw new TypeError("Platform adapters require an id.");
    }

    for (const method of requiredMethods) {
      if (typeof adapter[method] !== "function") {
        throw new TypeError(`Platform adapter '${adapter.id}' requires ${method}().`);
      }
    }

    if (adapters.has(adapter.id)) {
      throw new Error(`Platform adapter '${adapter.id}' is already registered.`);
    }

    adapters.set(adapter.id, adapter);
    return adapter;
  }

  function forUrl(url) {
    for (const adapter of adapters.values()) {
      try {
        if (adapter.matches(url)) return adapter;
      } catch {
        continue;
      }
    }
    return null;
  }

  globalThis.AIHR_PLATFORMS = Object.freeze({ register, forUrl });
})();
