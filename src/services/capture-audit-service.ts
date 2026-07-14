import type { CapturePlatform } from "@/capture/types";
import { getDb } from "@/lib/db";

export interface PlatformCaptureAudit {
  platform: CapturePlatform;
  importedConversations: number;
  importedMessages: number;
  indexedMessages: number;
  latestImportedAt: string | null;
  latestTitle: string | null;
  targetCounts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  latestDiscovery: {
    createdAt: string;
    targetsFound: number;
    failuresCount: number;
    scannedTitlesCount: number;
    stopReason: string | null;
    scrollsPerformed: number | null;
    exhaustive: boolean;
    exhausted: boolean;
    evidenceStrong: boolean;
  } | null;
  status: "not_started" | "in_progress" | "has_failures" | "captured";
  hint: string;
}

export interface CaptureAudit {
  generatedAt: string;
  platforms: PlatformCaptureAudit[];
  jobs: {
    total: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
  };
  totals: {
    importedConversations: number;
    importedMessages: number;
    indexedMessages: number;
    pendingTargets: number;
    failedTargets: number;
  };
  locallyConsistent: boolean;
  complete: boolean;
  readyForReview: boolean;
  completionNote: string;
  nextAction: string;
}

const expectedPlatforms: CapturePlatform[] = ["chatgpt", "gemini", "deepseek", "qwen"];

type PlatformImportRow = {
  platform: CapturePlatform;
  conversations: number;
  messages: number;
  latestImportedAt: string | null;
  latestTitle: string | null;
};

type PlatformIndexRow = {
  platform: CapturePlatform;
  indexedMessages: number;
};

type PlatformTargetRow = {
  platform: CapturePlatform;
  status: "pending" | "running" | "succeeded" | "failed";
  count: number;
};

type DiscoveryRunRow = {
  platform: CapturePlatform;
  created_at: string;
  targets_found: number;
  failures_count: number;
  scanned_titles_count: number;
  stop_reason: string | null;
  scrolls_performed: number | null;
  exhaustive: number;
  max_items_reached: number;
  max_scrolls_reached: number;
  extension_version: string | null;
  extension_build_id: string | null;
};

const requiredQwenDiscoveryBuild = "qwen-session-api-common-params-20260711";

function ensureAuditSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_discovery_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES capture_jobs(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      targets_found INTEGER NOT NULL,
      failures_count INTEGER NOT NULL,
      scanned_titles_count INTEGER NOT NULL,
      stop_reason TEXT,
      scrolls_performed INTEGER,
      max_items_reached INTEGER NOT NULL DEFAULT 0,
      max_scrolls_reached INTEGER NOT NULL DEFAULT 0,
      exhaustive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_capture_discovery_runs_platform_created
    ON capture_discovery_runs(platform, created_at);
  `);
}

function emptyCounts() {
  return {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0
  };
}

function platformStatus(
  importedConversations: number,
  counts: ReturnType<typeof emptyCounts>
): PlatformCaptureAudit["status"] {
  if (importedConversations === 0 && counts.pending === 0 && counts.succeeded === 0 && counts.failed === 0) {
    return "not_started";
  }

  if (counts.pending > 0 || counts.running > 0) {
    return "in_progress";
  }

  if (counts.failed > 0) {
    return "has_failures";
  }

  return importedConversations > 0 ? "captured" : "not_started";
}

function hintFor(status: PlatformCaptureAudit["status"], discovery: PlatformCaptureAudit["latestDiscovery"]) {
  if (status === "not_started") {
    return "还没有该平台的导入记录或采集目标。";
  }

  if (status === "in_progress") {
    return "该平台仍有待抓取或正在抓取的目标。";
  }

  if (status === "has_failures") {
    return "该平台存在失败目标；可登录后降低批次大小或提高 maxAttempts 重试。";
  }

  if (discovery && discovery.targetsFound === 0 && discovery.scannedTitlesCount === 0) {
    return "最近一次发现没有拿到历史标题；请确认该平台已登录且左侧历史列表可见。";
  }

  if (discovery && discovery.failuresCount > 0) {
    return "最近一次发现存在失败项；可降低频率、重新登录或单独重跑该平台。";
  }

  if (discovery?.evidenceStrong) {
    return "该平台已有成功导入记录，最近一次全量发现以连续无新增目标结束，并且发现阶段扫到了历史证据。";
  }

  if (discovery?.exhausted) {
    return "该平台最近一次全量发现以连续无新增目标结束，但发现证据偏弱。";
  }

  return "该平台已有成功导入记录。";
}

function readinessNote(platforms: PlatformCaptureAudit[], totals: CaptureAudit["totals"]) {
  const missingImports = platforms.filter((platform) => platform.importedConversations === 0);
  const missingExhaustion = platforms.filter((platform) => platform.latestDiscovery?.exhausted !== true);
  const weakDiscoveryEvidence = platforms.filter(
    (platform) => platform.importedConversations > 0 && platform.latestDiscovery?.evidenceStrong !== true
  );
  const discoveryFailures = platforms.filter(
    (platform) => platform.latestDiscovery && platform.latestDiscovery.failuresCount > 0
  );
  const inconsistentIndex = platforms.filter(
    (platform) => platform.importedMessages !== platform.indexedMessages || platform.importedMessages === 0
  );

  if (missingImports.length > 0) {
    return `还不能验收：${missingImports.map((platform) => platform.platform).join(", ")} 还没有导入记录。`;
  }

  if (totals.pendingTargets > 0) {
    return `还不能验收：仍有 ${totals.pendingTargets} 个待抓取或运行中的目标。`;
  }

  if (totals.failedTargets > 0) {
    return `还不能验收：仍有 ${totals.failedTargets} 个失败目标需要重试或确认跳过。`;
  }

  if (inconsistentIndex.length > 0) {
    return `还不能验收：${inconsistentIndex.map((platform) => platform.platform).join(", ")} 的消息索引数与导入数不一致。`;
  }

  if (missingExhaustion.length > 0) {
    return `接近完成，但缺少平台侧耗尽证据：${missingExhaustion.map((platform) => platform.platform).join(", ")}。`;
  }

  if (discoveryFailures.length > 0) {
    return `接近完成，但这些平台最近发现过程中仍有失败项：${discoveryFailures.map((platform) => platform.platform).join(", ")}。系统会优先重跑这些平台。`;
  }

  if (weakDiscoveryEvidence.length > 0) {
    return `接近完成，但这些平台的最近发现证据偏弱：${weakDiscoveryEvidence.map((platform) => platform.platform).join(", ")}。系统会优先重跑这些平台。`;
  }

  return "本地数据、索引、队列和最近全量发现耗尽证据都已就绪；可人工抽查平台历史列表后确认完成。";
}

export function getCaptureAudit(): CaptureAudit {
  ensureAuditSchema();
  const db = getDb();

  const importRows = db
    .prepare(
      `
      SELECT
        c.source_platform AS platform,
        COUNT(DISTINCT c.id) AS conversations,
        COUNT(m.id) AS messages,
        MAX(c.imported_at) AS latestImportedAt,
        (
          SELECT c2.title
          FROM conversations c2
          WHERE c2.source_platform = c.source_platform
          ORDER BY datetime(c2.imported_at) DESC
          LIMIT 1
        ) AS latestTitle
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.source_platform IN ('chatgpt', 'gemini', 'deepseek', 'qwen')
      GROUP BY c.source_platform
    `
    )
    .all() as PlatformImportRow[];

  const indexRows = db
    .prepare(
      `
      SELECT source_platform AS platform, COUNT(*) AS indexedMessages
      FROM search_index
      WHERE source_platform IN ('chatgpt', 'gemini', 'deepseek', 'qwen')
      GROUP BY source_platform
    `
    )
    .all() as PlatformIndexRow[];

  const targetRows = db
    .prepare(
      `
      SELECT platform, status, COUNT(*) AS count
      FROM capture_targets
      WHERE platform IN ('chatgpt', 'gemini', 'deepseek', 'qwen')
      GROUP BY platform, status
    `
    )
    .all() as PlatformTargetRow[];

  const discoveryRows = db
    .prepare(
      `
      SELECT *
      FROM capture_discovery_runs
      WHERE platform IN ('chatgpt', 'gemini', 'deepseek', 'qwen')
      ORDER BY datetime(created_at) DESC
    `
    )
    .all() as DiscoveryRunRow[];

  const jobRows = db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM capture_jobs
      GROUP BY status
    `
    )
    .all() as Array<{ status: keyof CaptureAudit["jobs"]; count: number }>;

  const jobs = {
    total: 0,
    ready: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  for (const row of jobRows) {
    if (row.status in jobs) {
      jobs[row.status] = row.count;
      jobs.total += row.count;
    }
  }

  const platforms = expectedPlatforms.map((platform): PlatformCaptureAudit => {
    const importRow = importRows.find((row) => row.platform === platform);
    const indexRow = indexRows.find((row) => row.platform === platform);
    const targetCounts = emptyCounts();

    for (const row of targetRows.filter((item) => item.platform === platform)) {
      targetCounts[row.status] = row.count;
    }

    const latestDiscoveryRow = discoveryRows.find((row) => row.platform === platform);
    const latestDiscovery = latestDiscoveryRow
      ? (() => {
          const exhausted =
            Boolean(latestDiscoveryRow.exhaustive) &&
            latestDiscoveryRow.stop_reason === "no_new_targets" &&
            !latestDiscoveryRow.max_items_reached &&
            !latestDiscoveryRow.max_scrolls_reached;
          const minimumDiscoveryEvidence = Math.min(Math.max(importRow?.conversations ?? 1, 1), 5);
          const buildEvidenceCurrent =
            platform !== "qwen" || latestDiscoveryRow.extension_build_id === requiredQwenDiscoveryBuild;
          const evidenceStrong =
            exhausted &&
            buildEvidenceCurrent &&
            latestDiscoveryRow.failures_count === 0 &&
            Math.max(latestDiscoveryRow.targets_found, latestDiscoveryRow.scanned_titles_count) >=
              minimumDiscoveryEvidence;

          return {
          createdAt: latestDiscoveryRow.created_at,
          targetsFound: latestDiscoveryRow.targets_found,
          failuresCount: latestDiscoveryRow.failures_count,
          scannedTitlesCount: latestDiscoveryRow.scanned_titles_count,
          stopReason: latestDiscoveryRow.stop_reason,
          scrollsPerformed: latestDiscoveryRow.scrolls_performed,
          exhaustive: Boolean(latestDiscoveryRow.exhaustive),
          exhausted,
          evidenceStrong
        };
        })()
      : null;
    const status = platformStatus(importRow?.conversations ?? 0, targetCounts);

    return {
      platform,
      importedConversations: importRow?.conversations ?? 0,
      importedMessages: importRow?.messages ?? 0,
      indexedMessages: indexRow?.indexedMessages ?? 0,
      latestImportedAt: importRow?.latestImportedAt ?? null,
      latestTitle: importRow?.latestTitle ?? null,
      targetCounts,
      latestDiscovery,
      status,
      hint: hintFor(status, latestDiscovery)
    };
  });

  const totals = platforms.reduce(
    (acc, platform) => ({
      importedConversations: acc.importedConversations + platform.importedConversations,
      importedMessages: acc.importedMessages + platform.importedMessages,
      indexedMessages: acc.indexedMessages + platform.indexedMessages,
      pendingTargets: acc.pendingTargets + platform.targetCounts.pending + platform.targetCounts.running,
      failedTargets: acc.failedTargets + platform.targetCounts.failed
    }),
    {
      importedConversations: 0,
      importedMessages: 0,
      indexedMessages: 0,
      pendingTargets: 0,
      failedTargets: 0
    }
  );

  const locallyConsistent =
    platforms.every(
      (platform) =>
        platform.importedConversations > 0 &&
        platform.importedMessages === platform.indexedMessages &&
        platform.latestDiscovery?.exhausted === true &&
        platform.latestDiscovery.evidenceStrong === true &&
        platform.latestDiscovery.failuresCount === 0 &&
        platform.status === "captured"
    ) &&
    totals.pendingTargets === 0 &&
    totals.failedTargets === 0;

  return {
    generatedAt: new Date().toISOString(),
    platforms,
    jobs,
    totals,
    locallyConsistent,
    complete: false,
    readyForReview: locallyConsistent,
    completionNote:
      "本地审计只能证明已导入数据和任务队列状态，不能单独证明平台侧全部历史已抓完；需要结合全量发现耗尽、任务完成和人工确认。",
    nextAction: readinessNote(platforms, totals)
  };
}
