import type { CapturePlatform } from "@/capture/types";
import { requireApiToken } from "@/lib/api-auth";
import {
  getPlatformSyncStates,
  markPlatformSyncDiscovered,
  markPlatformSyncFailed,
  markPlatformSyncStarted,
  markPlatformSyncSucceeded,
  setPlatformBackgroundEnabled
} from "@/services/platform-sync-service";

export const runtime = "nodejs";

const supportedPlatforms = new Set<CapturePlatform>(["chatgpt", "gemini", "deepseek", "qwen"]);

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  return Response.json({ states: getPlatformSyncStates() });
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const platform = raw.platform;
  if (typeof platform !== "string" || !supportedPlatforms.has(platform as CapturePlatform)) {
    return Response.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const typedPlatform = platform as CapturePlatform;
  if (raw.event === "started") {
    markPlatformSyncStarted(typedPlatform);
  } else if (raw.event === "discovered") {
    markPlatformSyncDiscovered(typedPlatform, typeof raw.lastSeenUrl === "string" ? raw.lastSeenUrl : null);
  } else if (raw.event === "succeeded") {
    markPlatformSyncSucceeded(typedPlatform, {
      newConversations: Number(raw.newConversations) || 0,
      newMessages: Number(raw.newMessages) || 0,
      lastSeenUrl: typeof raw.lastSeenUrl === "string" ? raw.lastSeenUrl : null
    });
  } else if (raw.event === "failed") {
    markPlatformSyncFailed(
      typedPlatform,
      typeof raw.error === "string" ? raw.error : "同步失败",
      typeof raw.backoffUntil === "string" ? raw.backoffUntil : null
    );
  } else if (raw.event === "background") {
    setPlatformBackgroundEnabled(typedPlatform, raw.enabled !== false);
  } else {
    return Response.json({ error: "Unsupported sync event" }, { status: 400 });
  }

  return Response.json({ ok: true, states: getPlatformSyncStates() });
}
