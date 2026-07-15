import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);

const {
  getApiTokenFromRequest,
  requireApiToken,
  isApiTokenAuthorized
} = await import("../src/lib/api-auth.ts");

test("does not treat missing local API token as a shared secret match", () => {
  const request = new Request("http://localhost/api/capture/audit");

  assert.equal(isApiTokenAuthorized(request, ""), false);
});

test("allows same-origin loopback requests when no local API token is configured", () => {
const request = new Request("http://localhost/api/capture/audit", {
    headers: {
      origin: "http://localhost"
    }
  });

  assert.equal(requireApiToken(request), null);
});

test("rejects cross-site requests when no local API token is configured", async () => {
  const request = new Request("http://localhost/api/capture/audit", {
    headers: {
      origin: "https://example.test"
    }
  });

  const response = requireApiToken(request);
  assert.equal(response?.status, 401);
});

test("allows chrome extension origin only on extension endpoints without a configured token", () => {
  const extensionRequest = new Request("http://localhost/api/extension/capture-page", {
    headers: {
      origin: "chrome-extension://example"
    }
  });
  const chromeControlRequest = new Request("http://localhost/api/capture/chrome", {
    headers: {
      origin: "chrome-extension://example"
    }
  });

  assert.equal(requireApiToken(extensionRequest), null);
  assert.equal(requireApiToken(chromeControlRequest)?.status, 401);
});

test("accepts the shared token from the X-AIHR-API-Token header", () => {
  const request = new Request("http://localhost/api/capture/audit", {
    headers: {
      "X-AIHR-API-Token": "local-secret"
    }
  });

  assert.equal(getApiTokenFromRequest(request), "local-secret");
  assert.equal(isApiTokenAuthorized(request, "local-secret"), true);
});

test("accepts the shared token from a bearer Authorization header", () => {
  const request = new Request("http://localhost/api/capture/audit", {
    headers: {
      Authorization: "Bearer local-secret"
    }
  });

  assert.equal(getApiTokenFromRequest(request), "local-secret");
  assert.equal(isApiTokenAuthorized(request, "local-secret"), true);
});

test("rejects missing or incorrect tokens when a token is configured", () => {
  const missing = new Request("http://localhost/api/capture/audit");
  const incorrect = new Request("http://localhost/api/capture/audit", {
    headers: {
      "X-AIHR-API-Token": "wrong-secret"
    }
  });

  assert.equal(isApiTokenAuthorized(missing, "local-secret"), false);
  assert.equal(isApiTokenAuthorized(incorrect, "local-secret"), false);
});

test("does not expose NEXT_PUBLIC API tokens through client headers", async () => {
  const publicTokenKey = ["NEXT_PUBLIC", "AIHR_API_TOKEN"].join("_");
  process.env[publicTokenKey] = "public-token-should-not-be-used";
  const { withApiToken } = await import(`../src/lib/client-api.ts?case=${Date.now()}`);

  assert.deepEqual(withApiToken({ "content-type": "application/json" }), {
    "content-type": "application/json"
  });

  delete process.env[publicTokenKey];
});
