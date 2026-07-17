import { createHash, randomUUID } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import type { MessageRole } from "@/types/conversation";

export type KnowledgeTaskType = "process";
export type KnowledgeJobStatus = "pending" | "running" | "completed" | "failed";

export interface KnowledgeJob {
  id: string;
  conversationId: string;
  taskType: KnowledgeTaskType;
  fingerprint: string;
  status: KnowledgeJobStatus;
  attempts: number;
  availableAt: string;
  leaseUntil: string | null;
  lastError: string | null;
  completionReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ClaimOptions {
  limit: number;
  now?: string;
  leaseSeconds?: number;
}

export interface KnowledgeQueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export const KNOWLEDGE_PROCESSOR_VERSION = "knowledge-v1";

export function knowledgeContentFingerprint(input: {
  title: string;
  messages: Array<{ role: MessageRole; content: string }>;
}) {
  const normalized = {
    processorVersion: KNOWLEDGE_PROCESSOR_VERSION,
    title: input.title.replace(/\s+/g, " ").trim(),
    messages: input.messages.map((message) => [
      message.role,
      message.content.replace(/\r\n/g, "\n").trim()
    ])
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

type KnowledgeJobRow = {
  id: string;
  conversation_id: string;
  task_type: KnowledgeTaskType;
  fingerprint: string;
  status: KnowledgeJobStatus;
  attempts: number;
  available_at: string;
  lease_until: string | null;
  last_error: string | null;
  completion_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function mapJob(row: KnowledgeJobRow): KnowledgeJob {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    taskType: row.task_type,
    fingerprint: row.fingerprint,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    leaseUntil: row.lease_until,
    lastError: row.last_error,
    completionReason: row.completion_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function getJob(id: string) {
  return getDb().prepare("SELECT * FROM knowledge_jobs WHERE id = ?").get(id) as KnowledgeJobRow | undefined;
}

function normalizedNow(value?: string) {
  const timestamp = value ?? nowIso();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Knowledge queue timestamp must be a valid date.");
  return timestamp;
}

export function enqueueKnowledgeJob(
  conversationId: string,
  taskType: KnowledgeTaskType,
  fingerprint: string,
  now?: string
): KnowledgeJob {
  if (!conversationId.trim() || !fingerprint.trim()) {
    throw new Error("Knowledge jobs require a conversation and content fingerprint.");
  }
  const timestamp = normalizedNow(now);
  const db = getDb();

  return db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT * FROM knowledge_jobs WHERE conversation_id = ? AND task_type = ? AND fingerprint = ?"
      )
      .get(conversationId, taskType, fingerprint) as KnowledgeJobRow | undefined;
    if (existing) return mapJob(existing);

    db.prepare(
      `
        UPDATE knowledge_jobs
        SET status = 'completed', completion_reason = 'superseded', completed_at = ?,
            lease_until = NULL, updated_at = ?
        WHERE conversation_id = ? AND task_type = ? AND status = 'pending'
      `
    ).run(timestamp, timestamp, conversationId, taskType);

    const id = randomUUID();
    db.prepare(
      `
        INSERT INTO knowledge_jobs (
          id, conversation_id, task_type, fingerprint, status, attempts, available_at,
          lease_until, last_error, completion_reason, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?, NULL)
      `
    ).run(id, conversationId, taskType, fingerprint, timestamp, timestamp, timestamp);
    return mapJob(getJob(id)!);
  }).immediate();
}

export function claimKnowledgeJobs(options: ClaimOptions): KnowledgeJob[] {
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("Knowledge queue claim limit must be a positive number.");
  }
  const limit = Math.min(100, Math.floor(options.limit));
  const timestamp = normalizedNow(options.now);
  const leaseSeconds = Math.max(30, Math.min(3600, Math.floor(options.leaseSeconds ?? 300)));
  const leaseUntil = new Date(Date.parse(timestamp) + leaseSeconds * 1000).toISOString();
  const db = getDb();

  return db.transaction(() => {
    const rows = db
      .prepare(
        `
          SELECT * FROM knowledge_jobs
          WHERE (status = 'pending' AND datetime(available_at) <= datetime(?))
             OR (status = 'running' AND lease_until IS NOT NULL AND datetime(lease_until) <= datetime(?))
          ORDER BY datetime(created_at) ASC, attempts ASC
          LIMIT ?
        `
      )
      .all(timestamp, timestamp, limit) as KnowledgeJobRow[];

    const claim = db.prepare(
      `
        UPDATE knowledge_jobs
        SET status = 'running', attempts = attempts + 1, lease_until = ?, last_error = NULL, updated_at = ?
        WHERE id = ?
      `
    );
    for (const row of rows) claim.run(leaseUntil, timestamp, row.id);
    return rows.map((row) => mapJob(getJob(row.id)!));
  }).immediate();
}

export function completeKnowledgeJob(id: string, now?: string): void {
  const timestamp = normalizedNow(now);
  const result = getDb()
    .prepare(
      `
        UPDATE knowledge_jobs
        SET status = 'completed', completion_reason = 'processed', completed_at = ?,
            lease_until = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'running'
      `
    )
    .run(timestamp, timestamp, id);
  if (result.changes !== 1) throw new Error("Knowledge job is not running.");
}

export function failKnowledgeJob(id: string, error: unknown, now?: string): void {
  const timestamp = normalizedNow(now);
  const db = getDb();
  const row = getJob(id);
  if (!row || row.status !== "running") throw new Error("Knowledge job is not running.");

  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (row.attempts >= 5) {
    db.prepare(
      `
        UPDATE knowledge_jobs
        SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `
    ).run(message, timestamp, id);
    return;
  }

  const delayMinutes = Math.min(360, 2 ** row.attempts);
  const availableAt = new Date(Date.parse(timestamp) + delayMinutes * 60_000).toISOString();
  db.prepare(
    `
      UPDATE knowledge_jobs
      SET status = 'pending', available_at = ?, lease_until = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `
  ).run(availableAt, message, timestamp, id);
}

export function getKnowledgeQueueStatus(): KnowledgeQueueStatus {
  const counts: KnowledgeQueueStatus = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) AS count FROM knowledge_jobs GROUP BY status")
    .all() as { status: KnowledgeJobStatus; count: number }[];
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

export function enqueueKnowledgeBackfill(limit = 100): number {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
  const db = getDb();
  const candidates = db
    .prepare(
      `
        SELECT c.id, c.title
        FROM conversations c
        LEFT JOIN conversation_insights ci ON ci.conversation_id = c.id
        WHERE ci.conversation_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_jobs kj
            WHERE kj.conversation_id = c.id
          )
        ORDER BY datetime(c.imported_at) DESC, c.id
        LIMIT ?
      `
    )
    .all(safeLimit) as Array<{ id: string; title: string }>;
  let enqueued = 0;
  for (const candidate of candidates) {
    const messages = db
      .prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY order_index")
      .all(candidate.id) as Array<{ role: MessageRole; content: string }>;
    if (!messages.length) continue;
    const job = enqueueKnowledgeJob(
      candidate.id,
      "process",
      knowledgeContentFingerprint({ title: candidate.title, messages })
    );
    if (job.status === "pending") enqueued += 1;
  }
  return enqueued;
}
