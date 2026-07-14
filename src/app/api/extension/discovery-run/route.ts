import { randomUUID } from "node:crypto";
import { requireApiToken } from "@/lib/api-auth";
import { getDb, nowIso } from "@/lib/db";
import type { CapturePlatform } from "@/capture/types";
import { markPlatformSyncDiscovered } from "@/services/platform-sync-service";

export const runtime = "nodejs";

const supportedPlatforms = new Set<CapturePlatform>(["chatgpt", "gemini", "deepseek", "qwen"]);

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const raw = body as {
    platform?: unknown;
    targetsFound?: unknown;
    failuresCount?: unknown;
    scannedTitlesCount?: unknown;
    stopReason?: unknown;
    scrollsPerformed?: unknown;
    maxItemsReached?: unknown;
    maxScrollsReached?: unknown;
    exhaustive?: unknown;
    extensionVersion?: unknown;
    extensionBuildId?: unknown;
    lastSeenUrl?: unknown;
    mode?: unknown;
  };

  const platform = raw.platform;
  if (typeof platform !== "string" || !supportedPlatforms.has(platform as CapturePlatform)) {
    return Response.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `
    INSERT INTO capture_discovery_runs (
      id, job_id, platform, targets_found, failures_count, scanned_titles_count,
      stop_reason, scrolls_performed, max_items_reached, max_scrolls_reached,
      exhaustive, extension_version, extension_build_id, created_at
      , discovery_mode
    )
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    randomUUID(),
    platform,
    Number(raw.targetsFound) || 0,
    Number(raw.failuresCount) || 0,
    Number(raw.scannedTitlesCount) || 0,
    typeof raw.stopReason === "string" ? raw.stopReason : null,
    typeof raw.scrollsPerformed === "number" ? raw.scrollsPerformed : null,
    raw.maxItemsReached ? 1 : 0,
    raw.maxScrollsReached ? 1 : 0,
    raw.exhaustive ? 1 : 0,
    typeof raw.extensionVersion === "string" ? raw.extensionVersion : null,
    typeof raw.extensionBuildId === "string" ? raw.extensionBuildId : null,
    nowIso(),
    raw.mode === "incremental" ? "incremental" : "full"
  );

  markPlatformSyncDiscovered(
    platform as CapturePlatform,
    typeof raw.lastSeenUrl === "string" ? raw.lastSeenUrl : null
  );

  return Response.json({ ok: true });
}
