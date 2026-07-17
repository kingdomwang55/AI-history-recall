(() => {
  const TOKEN_KEY = "aihrLocalApiToken";
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

  function normalizeEndpointCandidates(candidates) {
    if (!Array.isArray(candidates)) {
      throw new Error("Local API endpoint candidates must be approved loopback origins.");
    }

    return candidates.map((candidate) => {
      let parsed;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new Error("Local API endpoint candidates must be approved loopback origins.");
      }

      if (
        parsed.protocol !== "http:" ||
        !LOOPBACK_HOSTS.has(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("Local API endpoint candidates must be approved loopback origins.");
      }
      return parsed.origin;
    });
  }

  function createApiClient(options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch;
    const storage = options.storage;
    const getConfigUrl = options.getConfigUrl;
    const endpointCandidates = normalizeEndpointCandidates(
      options.endpointCandidates || globalThis.AIHR_CONSTANTS?.endpointCandidates || []
    );

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

    let tokenReady = null;

    function getToken() {
      tokenReady ||= loadToken();
      return tokenReady;
    }

    async function request(path, requestOptions = {}) {
      if (!fetchImpl) throw new Error("Fetch is unavailable.");
      if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
        throw new Error("Local API path must be an origin-relative path.");
      }
      if (!endpointCandidates.length) throw new Error("No local API endpoint is configured.");

      const requests = endpointCandidates.map((endpoint) => {
        const url = new URL(path, `${endpoint}/`);
        if (url.origin !== endpoint) {
          throw new Error("Local API path must remain on its configured loopback origin.");
        }
        return url.href;
      });
      const token = await getToken();
      const headers = token
        ? { ...(requestOptions.headers || {}), "X-AIHR-API-Token": token }
        : requestOptions.headers;
      let lastResponse = null;
      let lastError = null;

      for (const url of requests) {
        try {
          const response = await fetchImpl(url, {
            ...requestOptions,
            redirect: "error",
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
