import type { CapturePlatform } from "@/capture/types";
import { getDb, nowIso } from "@/lib/db";

export type PlatformSyncStatus = "idle" | "syncing" | "error" | "paused";

export interface PlatformSyncState {
  platform: CapturePlatform;
  lastSyncedAt: string | null;
  lastDiscoveredAt: string | null;
  lastSeenUrl: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  status: PlatformSyncStatus;
  lastNewConversations: number;
  lastNewMessages: number;
  consecutiveFailures: number;
  backoffUntil: string | null;
  backgroundEnabled: boolean;
  updatedAt: string;
}

const supportedPlatforms: CapturePlatform[] = ["chatgpt", "gemini", "deepseek", "qwen"];

type SyncStateRow = {
  platform: CapturePlatform;
  last_synced_at: string | null;
  last_discovered_at: string | null;
  last_seen_url: string | null;
  last_success_at: string | null;
  last_error: string | null;
  status: PlatformSyncStatus;
  last_new_conversations: number;
  last_new_messages: number;
  consecutive_failures: number;
  backoff_until: string | null;
  background_enabled: number;
  updated_at: string;
};

function ensureRows() {
  const insert = getDb().prepare(`
    INSERT OR IGNORE INTO platform_sync_state (platform, updated_at)
    VALUES (?, ?)
  `);
  const timestamp = nowIso();
  getDb().transaction(() => {
    for (const platform of supportedPlatforms) insert.run(platform, timestamp);
  })();
}

function mapRow(row: SyncStateRow): PlatformSyncState {
  return {
    platform: row.platform,
    lastSyncedAt: row.last_synced_at,
    lastDiscoveredAt: row.last_discovered_at,
    lastSeenUrl: row.last_seen_url,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    status: row.status,
    lastNewConversations: row.last_new_conversations,
    lastNewMessages: row.last_new_messages,
    consecutiveFailures: row.consecutive_failures,
    backoffUntil: row.backoff_until,
    backgroundEnabled: Boolean(row.background_enabled),
    updatedAt: row.updated_at
  };
}

export function getPlatformSyncStates() {
  ensureRows();
  const rows = getDb()
    .prepare(
      `SELECT * FROM platform_sync_state
       WHERE platform IN ('chatgpt', 'gemini', 'deepseek', 'qwen')
       ORDER BY CASE platform
         WHEN 'chatgpt' THEN 1 WHEN 'gemini' THEN 2 WHEN 'deepseek' THEN 3 ELSE 4 END`
    )
    .all() as SyncStateRow[];
  return rows.map(mapRow);
}

export function markPlatformSyncStarted(platform: CapturePlatform) {
  ensureRows();
  getDb()
    .prepare(`UPDATE platform_sync_state SET status = 'syncing', last_error = NULL, updated_at = ? WHERE platform = ?`)
    .run(nowIso(), platform);
}

export function markPlatformSyncDiscovered(platform: CapturePlatform, lastSeenUrl?: string | null) {
  ensureRows();
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE platform_sync_state
       SET last_discovered_at = ?, last_seen_url = COALESCE(?, last_seen_url), updated_at = ?
       WHERE platform = ?`
    )
    .run(timestamp, lastSeenUrl ?? null, timestamp, platform);
}

export function markPlatformSyncSucceeded(
  platform: CapturePlatform,
  result: { newConversations?: number; newMessages?: number; lastSeenUrl?: string | null } = {}
) {
  ensureRows();
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE platform_sync_state
       SET last_synced_at = ?, last_success_at = ?, last_seen_url = COALESCE(?, last_seen_url),
           last_error = NULL, status = 'idle', last_new_conversations = ?, last_new_messages = ?,
           consecutive_failures = 0, backoff_until = NULL, updated_at = ?
       WHERE platform = ?`
    )
    .run(
      timestamp,
      timestamp,
      result.lastSeenUrl ?? null,
      Math.max(0, result.newConversations ?? 0),
      Math.max(0, result.newMessages ?? 0),
      timestamp,
      platform
    );
}

export function markPlatformSyncFailed(platform: CapturePlatform, error: string, backoffUntil?: string | null) {
  ensureRows();
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE platform_sync_state
       SET last_synced_at = ?, last_error = ?, status = 'error',
           consecutive_failures = consecutive_failures + 1, backoff_until = ?, updated_at = ?
       WHERE platform = ?`
    )
    .run(timestamp, error, backoffUntil ?? null, timestamp, platform);
}

export function setPlatformBackgroundEnabled(platform: CapturePlatform, enabled: boolean) {
  ensureRows();
  getDb()
    .prepare(
      `UPDATE platform_sync_state
       SET background_enabled = ?, status = CASE WHEN ? THEN 'idle' ELSE 'paused' END, updated_at = ?
       WHERE platform = ?`
    )
    .run(enabled ? 1 : 0, enabled ? 1 : 0, nowIso(), platform);
}
