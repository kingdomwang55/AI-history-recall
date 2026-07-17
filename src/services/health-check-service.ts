import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import { getCaptureAudit } from "@/services/capture-audit-service";
import { getEmbeddingConfig, SEMANTIC_MODEL } from "@/services/semantic-index-service";

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "disabled";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  evidence: string;
  action?: { label: string; href: string };
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: Exclude<HealthStatus, "disabled">;
  generatedAt: string;
  checks: HealthCheck[];
}

const safeEvidenceIds = new Set([
  "database",
  "schema",
  "fts",
  "semantic",
  "disk",
  "capture",
  "extension",
  "model"
]);

export function aggregateHealth(checks: HealthCheck[]): HealthReport {
  const status = checks.some((check) => check.status === "unavailable")
    ? "unavailable"
    : checks.some((check) => check.status === "degraded")
      ? "degraded"
      : "healthy";
  return { status, generatedAt: nowIso(), checks };
}

function sanitizeText(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:token|secret|api[-_ ]?key)[\w-]*/gi, "[redacted]")
    .replace(/(^|[\s'"])(\/(?:[^\s,'"]+\/?)+)/g, "$1[local path]")
    .replace(/[A-Za-z]:\\[^\s,;'"\\]+(?:\\[^\s,;'"\\]+)*/g, "[local path]");
}

function redactDetails(value: unknown, key = ""): unknown {
  const normalizedKey = key.toLowerCase();
  if (["apikey", "api_key", "token", "authorization", "content", "messages", "path", "dbpath"].includes(normalizedKey)) {
    return "[redacted]";
  }
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => redactDetails(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactDetails(childValue, childKey)
      ])
    );
  }
  return value;
}

export function redactHealthReport(report: HealthReport): HealthReport {
  return {
    status: report.status,
    generatedAt: report.generatedAt,
    checks: report.checks.map((check) => ({
      id: check.id,
      label: sanitizeText(check.label),
      status: check.status,
      evidence: safeEvidenceIds.has(check.id) ? sanitizeText(check.evidence) : "[redacted]",
      ...(check.action ? { action: check.action } : {}),
      ...(check.details ? { details: redactDetails(check.details) as Record<string, unknown> } : {})
    }))
  };
}

function databaseChecks(): HealthCheck[] {
  const db = getDb();
  const checks: HealthCheck[] = [];

  try {
    const result = db.pragma("quick_check", { simple: true }) as string;
    db.exec("SAVEPOINT health_write_probe");
    try {
      const timestamp = nowIso();
      db.prepare(
        "INSERT INTO health_check_runs (id, status, report_json, generated_at, created_at) VALUES (?, 'healthy', '{}', ?, ?)"
      ).run(randomUUID(), timestamp, timestamp);
      db.exec("ROLLBACK TO health_write_probe");
    } finally {
      db.exec("RELEASE health_write_probe");
    }
    checks.push({
      id: "database",
      label: "本地数据库",
      status: result === "ok" ? "healthy" : "unavailable",
      evidence: result === "ok" ? "SQLite 可读写，完整性检查通过。" : `SQLite quick_check: ${result}`
    });
  } catch (error) {
    checks.push({
      id: "database",
      label: "本地数据库",
      status: "unavailable",
      evidence: error instanceof Error ? error.message : "数据库检查失败。",
      action: { label: "查看修复建议", href: "/health#database" }
    });
  }

  const version = db.pragma("user_version", { simple: true }) as number;
  checks.push({
    id: "schema",
    label: "数据库结构",
    status: version >= 1 ? "healthy" : "degraded",
    evidence: `Schema version ${version}`
  });

  const messages = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
  const fts = (db.prepare("SELECT COUNT(*) AS count FROM search_index").get() as { count: number }).count;
  const embedding = getEmbeddingConfig();
  const semanticModel =
    embedding.provider === "local" ? SEMANTIC_MODEL : `${embedding.provider}:${embedding.model}`;
  const semantic = (
    db.prepare("SELECT COUNT(*) AS count FROM semantic_index WHERE model = ?").get(semanticModel) as { count: number }
  ).count;
  checks.push({
    id: "fts",
    label: "全文索引",
    status: fts === messages ? "healthy" : "degraded",
    evidence: `${fts}/${messages} 条消息已建立全文索引。`,
    action: fts === messages ? undefined : { label: "重建索引", href: "/conversations" }
  });
  checks.push({
    id: "semantic",
    label: "语义索引",
    status: semantic === messages ? "healthy" : "degraded",
    evidence: `${semantic}/${messages} 条消息已建立语义索引。`,
    action: semantic === messages ? undefined : { label: "重建索引", href: "/conversations" }
  });
  return checks;
}

function diskCheck(): HealthCheck {
  try {
    const dbPath = process.env.AIHR_DB_PATH ?? path.join(process.cwd(), "data", "ai-history-recall.sqlite");
    const stats = fs.statfsSync(path.dirname(dbPath));
    const availableMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024);
    return {
      id: "disk",
      label: "磁盘空间",
      status: availableMb >= 100 ? "healthy" : "degraded",
      evidence: `数据库所在磁盘剩余约 ${availableMb} MB。`
    };
  } catch {
    return { id: "disk", label: "磁盘空间", status: "degraded", evidence: "暂时无法读取可用磁盘空间。" };
  }
}

function captureChecks(): HealthCheck[] {
  try {
    const db = getDb();
    const audit = getCaptureAudit();
    const latest = db
      .prepare(
        "SELECT extension_version, extension_build_id FROM capture_discovery_runs WHERE extension_version IS NOT NULL ORDER BY datetime(created_at) DESC LIMIT 1"
      )
      .get() as { extension_version: string; extension_build_id: string | null } | undefined;
    return [
      {
        id: "capture",
        label: "采集数据",
        status: audit.locallyConsistent ? "healthy" : "degraded",
        evidence: audit.locallyConsistent
          ? `${audit.totals.importedConversations} 个对话，采集数据与索引一致。`
          : "采集数据、任务或索引存在不一致。",
        action: audit.locallyConsistent ? undefined : { label: "打开采集诊断", href: "/capture" }
      },
      latest
        ? {
            id: "extension",
            label: "Chrome 扩展",
            status: "healthy",
            evidence: `最近记录版本 ${latest.extension_version}，构建 ${latest.extension_build_id ?? "unknown"}。`
          }
        : {
            id: "extension",
            label: "Chrome 扩展",
            status: "degraded",
            evidence: "尚无扩展发现运行证据。",
            action: { label: "连接扩展", href: "/capture" }
          }
    ];
  } catch (error) {
    return [
      {
        id: "capture",
        label: "采集数据",
        status: "degraded",
        evidence: error instanceof Error ? error.message : "采集检查失败。",
        action: { label: "打开采集诊断", href: "/capture" }
      }
    ];
  }
}

function modelCheck(): HealthCheck {
  const config = getEmbeddingConfig();
  if (config.provider === "local") {
    return { id: "model", label: "Embedding 模型", status: "disabled", evidence: "未启用外部 embedding 模型。" };
  }
  return {
    id: "model",
    label: "Embedding 模型",
    status: "healthy",
    evidence: `已配置 ${config.provider}:${config.model}；常规健康检查不会连接模型。`
  };
}

export function getHealthReport(): HealthReport {
  let database: HealthCheck[];
  try {
    database = databaseChecks();
  } catch (error) {
    database = [
      {
        id: "database",
        label: "本地数据库",
        status: "unavailable",
        evidence: error instanceof Error ? error.message : "数据库无法打开。",
        action: { label: "查看修复建议", href: "/health#database" }
      }
    ];
  }
  return aggregateHealth([...database, diskCheck(), ...captureChecks(), modelCheck()]);
}

export function recordHealthSnapshot(report: HealthReport) {
  const db = getDb();
  const redacted = redactHealthReport(report);
  db.transaction(() => {
    db.prepare(
      "INSERT INTO health_check_runs (id, status, report_json, generated_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(randomUUID(), redacted.status, JSON.stringify(redacted), redacted.generatedAt, nowIso());
    db.prepare(
      "DELETE FROM health_check_runs WHERE id NOT IN (SELECT id FROM health_check_runs ORDER BY datetime(generated_at) DESC, rowid DESC LIMIT 100)"
    ).run();
  })();
}
