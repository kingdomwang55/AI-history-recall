import { requireApiToken } from "@/lib/api-auth";
import { preflightChromePlatformPages } from "@/services/chrome-cdp-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const platforms =
    typeof body === "object" && body !== null
      ? (body as { platforms?: unknown }).platforms
      : undefined;

  const result = await preflightChromePlatformPages(platforms);

  return Response.json(
    {
      ...result,
      ready:
        result.status.ok &&
        result.platforms.every((platform) => platform.open && platform.likelyLoggedIn !== false)
    },
    { status: result.status.ok ? 200 : 500 }
  );
}
