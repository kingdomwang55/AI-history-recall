(() => {
  const TOKEN_KEY = "aihrLocalApiToken";

  function createApiClient(options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch;
    const storage = options.storage;
    const getConfigUrl = options.getConfigUrl;
    const endpointCandidates = options.endpointCandidates || globalThis.AIHR_CONSTANTS?.endpointCandidates || [];

    async function loadToken() {
      if (storage) {
        const stored = await storage.get(TOKEN_KEY);
        if (typeof stored?.[TOKEN_KEY] === "string") return stored[TOKEN_KEY].trim();
      }

      if (!getConfigUrl || !fetchImpl) return "";
      try {
        const response = await fetchImpl(getConfigUrl("config.js"));
        if (!response.ok) return "";
        const source = await response.text();
        const match = source.match(/AIHR_LOCAL_API_TOKEN\s*=\s*("(?:[^"\\]|\\.)*")/);
        const token = match ? JSON.parse(match[1]).trim() : "";
        if (token && storage) await storage.set({ [TOKEN_KEY]: token });
        return token;
      } catch {
        return "";
      }
    }

    const tokenReady = loadToken();

    async function request(path, requestOptions = {}) {
      if (!fetchImpl) throw new Error("Fetch is unavailable.");
      const token = await tokenReady;
      const headers = token
        ? { ...(requestOptions.headers || {}), "X-AIHR-API-Token": token }
        : requestOptions.headers;
      let lastResponse = null;
      let lastError = null;

      for (const endpoint of endpointCandidates) {
        try {
          const response = await fetchImpl(new URL(path, `${endpoint}/`).href, {
            ...requestOptions,
            ...(headers ? { headers } : {})
          });
          lastResponse = response;
          if (response.ok) return response;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastResponse) return lastResponse;
      throw lastError || new Error("No local API endpoint is configured.");
    }

    return Object.freeze({ request });
  }

  const defaultClient = createApiClient({
    fetch: globalThis.fetch,
    storage: globalThis.AIHR_CHROME_API?.storage,
    getConfigUrl: globalThis.AIHR_CHROME_API?.runtimeUrl,
    endpointCandidates: globalThis.AIHR_CONSTANTS?.endpointCandidates
  });

  globalThis.AIHR_API = Object.freeze({
    createApiClient,
    request: defaultClient.request
  });
})();
