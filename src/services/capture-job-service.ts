import { randomUUID } from "node:crypto";
import { discoverBrowserHistoryTargets, runBrowserCapture } from "@/capture/browser-runner";
import { createLlmAgentPlan } from "@/capture/agent";
import type { CaptureAgentPlan } from "@/capture/agent";
import type {
  BrowserCaptureResult,
  CaptureDiscoveryResult,
  CapturePlatform,
  CaptureRateLimit,
  CaptureTarget
} from "@/capture/types";
import { getDb, nowIso } from "@/lib/db";
import { importParsedConversations } from "@/services/import-service";

export type CaptureJobStatus = "ready" | "running" | "completed" | "failed";
export type CaptureTargetStatus = "pending" | "running" | "succeeded" | "failed";

export interface CaptureJobSummary {
  id: string;
  instruction: string;
  status: CaptureJobStatus;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  counts: Record<CaptureTargetStatus, number>;
  totalTargets: number;
}

export interface CaptureTargetRecord extends CaptureTarget {
  id: string;
  jobId: string;
  status: CaptureTargetStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureJobDetail extends CaptureJobSummary {
  targets: CaptureTargetRecord[];
}

export interface CreateCaptureJobResult {
  job: CaptureJobDetail;
  plan: CaptureAgentPlan;
  discoveredTargets: number;
  discoveryFailures: Array<{
    platform: CapturePlatform;
    title?: string;
    error: string;
  }>;
}

export interface RunCaptureJobBatchResult {
  job: CaptureJobDetail;
  capture: BrowserCaptureResult;
  imported: ReturnType<typeof importParsedConversations> | null;
  processedTargetIds: string[];
}

export interface RunCaptureJobOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export interface RunCaptureJobUntilIdleOptions extends RunCaptureJobOptions {
  maxBatches?: number;
  batchDelayMs?: number;
}

export interface RunCaptureJobUntilIdleResult {
  job: CaptureJobDetail;
  batches: RunCaptureJobBatchResult[];
  stoppedReason: "completed" | "no_eligible_targets" | "max_batches";
}

type CaptureJobRow = {
  id: string;
  instruction: string;
  status: CaptureJobStatus;
  created_at: string;
  updated_at: string;
  last_error: string | null;
};

type CaptureTargetRow = {
  id: string;
  job_id: string;
  platform: CapturePlatform;
  url: string;
  title: string | null;
  status: CaptureTargetStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const defaultRateLimit: Partial<CaptureRateLimit> = {
  pageDelayMs: 4300,
  pageJitterMs: 2800,
  afterScrollDelayMs: 1600
};

function ensureCaptureSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_jobs (
      id TEXT PRIMARY KEY,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready', 'running', 'completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS capture_targets (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES capture_jobs(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, platform, url)
    );

    CREATE INDEX IF NOT EXISTS idx_capture_targets_job_status
    ON capture_targets(job_id, status);

    CREATE INDEX IF NOT EXISTS idx_capture_targets_platform
    ON capture_targets(platform);

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

function uniqueTargets(targets: CaptureTarget[]) {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.platform}:${target.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapTarget(row: CaptureTargetRow): CaptureTargetRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    platform: row.platform,
    url: row.url,
    title: row.title ?? undefined,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function targetCounts(jobId: string) {
  const db = getDb();
  const counts: Record<CaptureTargetStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0
  };

  const rows = db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM capture_targets
      WHERE job_id = ?
      GROUP BY status
    `
    )
    .all(jobId) as { status: CaptureTargetStatus; count: number }[];

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}

function mapJob(row: CaptureJobRow): CaptureJobSummary {
  const counts = targetCounts(row.id);
  const totalTargets = counts.pending + counts.running + counts.succeeded + counts.failed;

  return {
    id: row.id,
    instruction: row.instruction,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
    counts,
    totalTargets
  };
}

export function listCaptureJobs(): CaptureJobSummary[] {
  ensureCaptureSchema();
  const db = getDb();
  return (db
    .prepare(
      `
      SELECT *
      FROM capture_jobs
      ORDER BY datetime(updated_at) DESC
      LIMIT 20
    `
    )
    .all() as CaptureJobRow[]).map(mapJob);
}

export function getCaptureJob(id: string): CaptureJobDetail | null {
  ensureCaptureSchema();
  const db = getDb();
  const row = db.prepare("SELECT * FROM capture_jobs WHERE id = ?").get(id) as CaptureJobRow | undefined;

  if (!row) {
    return null;
  }

  const targets = (db
    .prepare(
      `
      SELECT *
      FROM capture_targets
      WHERE job_id = ?
      ORDER BY datetime(created_at) ASC
    `
    )
    .all(id) as CaptureTargetRow[]).map(mapTarget);

  return {
    ...mapJob(row),
    targets
  };
}

type DiscoveryEvidence = CaptureDiscoveryResult & {
  platform: CapturePlatform;
};

async function resolvePlanTargets(plan: CaptureAgentPlan) {
  const targets: CaptureTarget[] = [];
  const discoveryFailures: CreateCaptureJobResult["discoveryFailures"] = [];
  const discoveryRuns: DiscoveryEvidence[] = [];
  let discoveredTargets = 0;

  for (const action of plan.actions) {
    if (action.type === "capture") {
      targets.push(...action.targets);
    }

    if (action.type === "discover") {
      const discovery = await discoverBrowserHistoryTargets({
        platform: action.platform,
        maxItems: action.maxItems,
        maxScrolls: action.maxScrolls,
        stopAfterNoNewScrolls: action.stopAfterNoNewScrolls,
        exhaustive: action.exhaustive,
        startUrl: action.startUrl,
        rateLimit: action.rateLimit
      });

      targets.push(...discovery.targets);
      discoveredTargets += discovery.targets.length;
      discoveryFailures.push(...discovery.failures);
      discoveryRuns.push({ ...discovery, platform: action.platform });
    }
  }

  return {
    targets: uniqueTargets(targets).slice(0, 1000),
    discoveredTargets,
    discoveryFailures,
    discoveryRuns
  };
}

export async function createCaptureJob(instruction: string): Promise<CreateCaptureJobResult> {
  ensureCaptureSchema();
  const db = getDb();
  const plan = await createLlmAgentPlan(instruction);
  const now = nowIso();
  const jobId = randomUUID();

  try {
    const resolved = await resolvePlanTargets(plan);

    const transaction = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO capture_jobs (id, instruction, status, created_at, updated_at, last_error)
        VALUES (?, ?, 'ready', ?, ?, NULL)
      `
      ).run(jobId, instruction, now, now);

      const insertTarget = db.prepare(
        `
        INSERT OR IGNORE INTO capture_targets (
          id, job_id, platform, url, title, status, attempts, error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
      `
      );

      for (const target of resolved.targets) {
        insertTarget.run(
          randomUUID(),
          jobId,
          target.platform,
          target.url,
          target.title ?? null,
          now,
          now
        );
      }

      const insertDiscoveryRun = db.prepare(
        `
        INSERT INTO capture_discovery_runs (
          id, job_id, platform, targets_found, failures_count, scanned_titles_count,
          stop_reason, scrolls_performed, max_items_reached, max_scrolls_reached,
          exhaustive, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );

      for (const run of resolved.discoveryRuns) {
        insertDiscoveryRun.run(
          randomUUID(),
          jobId,
          run.platform,
          run.targets.length,
          run.failures.length,
          run.scannedTitles.length,
          run.stopReason ?? null,
          run.scrollsPerformed ?? null,
          run.maxItemsReached ? 1 : 0,
          run.maxScrollsReached ? 1 : 0,
          run.exhaustive ? 1 : 0,
          now
        );
      }
    });

    transaction();

    return {
      job: getCaptureJob(jobId) as CaptureJobDetail,
      plan,
      discoveredTargets: resolved.discoveredTargets,
      discoveryFailures: resolved.discoveryFailures
    };
  } catch (error) {
    const transaction = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO capture_jobs (id, instruction, status, created_at, updated_at, last_error)
        VALUES (?, ?, 'failed', ?, ?, ?)
      `
      ).run(jobId, instruction, now, now, error instanceof Error ? error.message : "创建采集任务失败");
    });

    transaction();
    throw error;
  }
}

function selectPendingTargets(jobId: string, batchSize: number, maxAttempts: number) {
  const db = getDb();
  return (db
    .prepare(
      `
      SELECT *
      FROM capture_targets
      WHERE job_id = ?
        AND (
          status = 'pending'
          OR (status = 'failed' AND attempts < ?)
        )
      ORDER BY attempts ASC, datetime(created_at) ASC
      LIMIT ?
    `
    )
    .all(jobId, maxAttempts, batchSize) as CaptureTargetRow[]).map(mapTarget);
}

function refreshJobStatus(jobId: string, lastError: string | null = null) {
  const db = getDb();
  const counts = targetCounts(jobId);
  const status: CaptureJobStatus =
    counts.pending === 0 && counts.running === 0 && counts.failed === 0
      ? "completed"
      : counts.pending === 0 && counts.running === 0 && counts.failed > 0
        ? "failed"
        : "ready";

  db.prepare(
    `
    UPDATE capture_jobs
    SET status = ?, updated_at = ?, last_error = ?
    WHERE id = ?
  `
  ).run(status, nowIso(), lastError, jobId);
}

export async function runCaptureJobBatch(
  jobId: string,
  options: RunCaptureJobOptions | number = {}
): Promise<RunCaptureJobBatchResult> {
  ensureCaptureSchema();
  const db = getDb();
  const job = getCaptureJob(jobId);

  if (!job) {
    throw new Error("采集任务不存在");
  }

  const batchSize = typeof options === "number" ? options : options.batchSize ?? 5;
  const maxAttempts = typeof options === "number" ? 3 : options.maxAttempts ?? 3;
  const safeBatchSize = Math.min(Math.max(batchSize, 1), 20);
  const safeMaxAttempts = Math.min(Math.max(maxAttempts, 1), 10);
  const targets = selectPendingTargets(jobId, safeBatchSize, safeMaxAttempts);

  if (targets.length === 0) {
    refreshJobStatus(jobId);
    return {
      job: getCaptureJob(jobId) as CaptureJobDetail,
      capture: { conversations: [], failures: [] },
      imported: null,
      processedTargetIds: []
    };
  }

  const now = nowIso();
  const targetIds = targets.map((target) => target.id);

  db.prepare(
    `
    UPDATE capture_jobs
    SET status = 'running', updated_at = ?, last_error = NULL
    WHERE id = ?
  `
  ).run(now, jobId);

  const markRunning = db.prepare(
    `
    UPDATE capture_targets
    SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = ?
    WHERE id = ?
  `
  );
  for (const targetId of targetIds) {
    markRunning.run(now, targetId);
  }

  try {
    const captureTargets = targets.map(({ platform, url, title }) => ({ platform, url, title }));
    const capture = await runBrowserCapture({
      targets: captureTargets,
      rateLimit: defaultRateLimit,
      importAfterCapture: true
    });
    const imported =
      capture.conversations.length > 0
        ? importParsedConversations(
            capture.conversations,
            `capture-job-${jobId}-${new Date().toISOString()}.json`,
            "browser_capture_job"
          )
        : null;

    const succeededUrls = new Set(capture.conversations.map((conversation) => conversation.sourceUrl));
    const failuresByUrl = new Map(capture.failures.map((failure) => [failure.url, failure.error]));
    const doneAt = nowIso();

    const markSucceeded = db.prepare(
      `
      UPDATE capture_targets
      SET status = 'succeeded', error = NULL, updated_at = ?
      WHERE id = ?
    `
    );
    const markFailed = db.prepare(
      `
      UPDATE capture_targets
      SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ?
    `
    );

    for (const target of targets) {
      if (succeededUrls.has(target.url)) {
        markSucceeded.run(doneAt, target.id);
        continue;
      }

      markFailed.run(failuresByUrl.get(target.url) ?? "未提取到有效对话", doneAt, target.id);
    }

    refreshJobStatus(jobId, capture.failures[0]?.error ?? null);

    return {
      job: getCaptureJob(jobId) as CaptureJobDetail,
      capture,
      imported,
      processedTargetIds: targetIds
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量采集失败";
    const failedAt = nowIso();
    const markFailed = db.prepare(
      `
      UPDATE capture_targets
      SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ?
    `
    );

    for (const targetId of targetIds) {
      markFailed.run(message, failedAt, targetId);
    }

    db.prepare(
      `
      UPDATE capture_jobs
      SET status = 'failed', updated_at = ?, last_error = ?
      WHERE id = ?
    `
    ).run(failedAt, message, jobId);

    throw error;
  }
}

export async function runCaptureJobUntilIdle(
  jobId: string,
  options: RunCaptureJobUntilIdleOptions = {}
): Promise<RunCaptureJobUntilIdleResult> {
  const maxBatches = Math.min(Math.max(options.maxBatches ?? 10, 1), 100);
  const batchDelayMs = Math.min(Math.max(options.batchDelayMs ?? 12000, 3000), 120000);
  const batches: RunCaptureJobBatchResult[] = [];

  for (let index = 0; index < maxBatches; index += 1) {
    const batch = await runCaptureJobBatch(jobId, {
      batchSize: options.batchSize,
      maxAttempts: options.maxAttempts
    });

    batches.push(batch);

    if (batch.processedTargetIds.length === 0) {
      return {
        job: batch.job,
        batches,
        stoppedReason:
          batch.job.counts.pending === 0 && batch.job.counts.failed === 0
            ? "completed"
            : "no_eligible_targets"
      };
    }

    if (batch.job.counts.pending === 0 && batch.job.counts.running === 0) {
      return {
        job: batch.job,
        batches,
        stoppedReason: batch.job.counts.failed > 0 ? "no_eligible_targets" : "completed"
      };
    }

    if (index < maxBatches - 1) {
      await sleep(batchDelayMs);
    }
  }

  return {
    job: getCaptureJob(jobId) as CaptureJobDetail,
    batches,
    stoppedReason: "max_batches"
  };
}
