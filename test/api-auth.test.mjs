import test from "node:test";
import assert from "node:assert/strict";

import {
  getApiTokenFromRequest,
  isApiTokenAuthorized
} from "../src/lib/api-auth.ts";

test("allows requests when no local API token is configured", () => {
  const request = new Request("http://localhost/api/capture/audit");

  assert.equal(isApiTokenAuthorized(request, ""), true);
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
