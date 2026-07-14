export const API_TOKEN_HEADER = "X-AIHR-API-Token";

export function getConfiguredApiToken() {
  return (process.env.AIHR_API_TOKEN || "").trim();
}

export function getApiTokenFromRequest(request: Request) {
  const directToken = request.headers.get(API_TOKEN_HEADER);
  if (directToken?.trim()) {
    return directToken.trim();
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) {
    return "";
  }

  const [scheme, ...rest] = authorization.split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") {
    return "";
  }

  return rest.join(" ").trim();
}

export function isApiTokenAuthorized(request: Request, configuredToken = getConfiguredApiToken()) {
  const expected = configuredToken.trim();
  if (!expected) {
    return true;
  }

  return getApiTokenFromRequest(request) === expected;
}

export function requireApiToken(request: Request) {
  if (isApiTokenAuthorized(request)) {
    return null;
  }

  return Response.json(
    {
      error: "Missing or invalid local API token"
    },
    { status: 401 }
  );
}
