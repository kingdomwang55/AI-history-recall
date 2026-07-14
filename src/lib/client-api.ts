const API_TOKEN_HEADER = "X-AIHR-API-Token";

export function withApiToken(headers: HeadersInit = {}) {
  const token = process.env.AIHR_LOCAL_API_TOKEN?.trim();
  if (!token) {
    return headers;
  }

  return {
    ...headers,
    [API_TOKEN_HEADER]: token
  };
}
