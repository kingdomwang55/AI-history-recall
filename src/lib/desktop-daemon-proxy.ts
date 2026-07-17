import { getConfiguredApiToken, requireApiToken } from "@/lib/api-auth";

const daemonOrigin = `http://127.0.0.1:${process.env.AIHR_DAEMON_PORT || "32145"}`;

export async function proxyDesktopDaemon(request: Request, pathname: string) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  const token = getConfiguredApiToken();
  if (!token) return Response.json({ error: "Desktop daemon is not configured" }, { status: 503 });

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  try {
    const response = await fetch(`${daemonOrigin}${pathname}`, {
      method: request.method,
      cache: "no-store",
      headers: {
        "X-AIHR-API-Token": token,
        ...(request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type") as string }
          : {})
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(15_000)
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Desktop daemon is unavailable" },
      { status: 502 }
    );
  }
}
