export function withApiToken(headers: HeadersInit = {}) {
  if (typeof window === "undefined") return headers;
  const token = window.localStorage.getItem("aihrLocalApiToken")?.trim();
  if (!token) return headers;
  const output = new Headers(headers);
  output.set("X-AIHR-API-Token", token);
  return output;
}
