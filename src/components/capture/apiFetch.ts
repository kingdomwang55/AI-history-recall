import { withApiToken } from "@/lib/client-api";

export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: withApiToken(init?.headers)
  });
}
