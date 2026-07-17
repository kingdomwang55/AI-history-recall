"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clipboard,
  MinusCircle,
  RefreshCw,
  Wrench,
  XCircle
} from "lucide-react";
import { useState } from "react";
import type { HealthCheck, HealthReport, HealthStatus } from "@/services/health-check-service";

const statusCopy: Record<HealthStatus, { label: string; className: string }> = {
  healthy: { label: "正常", className: "health-status-healthy" },
  degraded: { label: "需关注", className: "health-status-degraded" },
  unavailable: { label: "不可用", className: "health-status-unavailable" },
  disabled: { label: "未启用", className: "health-status-disabled" }
};

const checkGroups = [
  { title: "核心服务", ids: ["database", "schema", "disk", "resources"] },
  { title: "检索与知识", ids: ["fts", "semantic", "model"] },
  { title: "采集链路", ids: ["capture", "extension"] }
];

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "healthy") return <CheckCircle2 aria-hidden="true" />;
  if (status === "degraded") return <AlertTriangle aria-hidden="true" />;
  if (status === "unavailable") return <XCircle aria-hidden="true" />;
  return <MinusCircle aria-hidden="true" />;
}

function CheckRow({
  check,
  repairing,
  onRepair
}: {
  check: HealthCheck;
  repairing: boolean;
  onRepair: (check: HealthCheck) => void;
}) {
  const copy = statusCopy[check.status];
  const canReindex = check.id === "fts" || check.id === "semantic";
  return (
    <article className="health-check-row" id={check.id}>
      <div className={`health-check-icon ${copy.className}`}>
        <StatusIcon status={check.status} />
      </div>
      <div className="health-check-copy">
        <div className="health-check-heading">
          <h3>{check.label}</h3>
          <span className={`health-status-label ${copy.className}`}>{copy.label}</span>
        </div>
        <p>{check.evidence}</p>
      </div>
      {check.action && canReindex ? (
        <button className="health-repair-link" type="button" onClick={() => onRepair(check)} disabled={repairing}>
          <Wrench size={14} aria-hidden="true" />
          <span>{repairing ? "修复中" : `修复：${check.action.label}`}</span>
        </button>
      ) : check.action ? (
        <Link className="health-repair-link" href={check.action.href}>
          <Wrench size={14} aria-hidden="true" />
          <span>修复：{check.action.label}</span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

export function HealthDashboard({ initialReport }: { initialReport: HealthReport }) {
  const [report, setReport] = useState(initialReport);
  const [refreshing, setRefreshing] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const aggregate = statusCopy[report.status];

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("健康检查请求失败");
      const payload = (await response.json()) as { health: HealthReport };
      setReport(payload.health);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法刷新诊断报告");
    } finally {
      setRefreshing(false);
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setNotice("诊断报告已复制");
    } catch {
      setNotice("复制失败，请检查剪贴板权限");
    }
  }

  async function repair(check: HealthCheck) {
    setRepairing(check.id);
    setNotice("");
    try {
      const response = await fetch("/api/search/reindex", { method: "POST" });
      if (!response.ok) throw new Error("索引重建失败");
      setNotice("索引已重建，正在更新诊断结果");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "修复失败");
    } finally {
      setRepairing(null);
    }
  }

  return (
    <div className="health-workspace">
      <section className={`health-summary-band ${aggregate.className}`} aria-live="polite">
        <div className="health-summary-icon"><StatusIcon status={report.status} /></div>
        <div>
          <div className="health-summary-label">系统状态</div>
          <h2>{aggregate.label}</h2>
          <p>最近检查：{new Date(report.generatedAt).toLocaleString("zh-CN")}</p>
        </div>
        <div className="health-summary-actions">
          <button type="button" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "health-spin" : undefined} aria-hidden="true" />
            重新检查
          </button>
          <button type="button" onClick={copyReport}>
            <Clipboard size={15} aria-hidden="true" />
            复制诊断报告
          </button>
        </div>
      </section>

      {notice ? <p className="health-notice" role="status">{notice}</p> : null}

      <div className="health-groups">
        {checkGroups.map((group) => {
          const checks = group.ids
            .map((id) => report.checks.find((check) => check.id === id))
            .filter((check): check is HealthCheck => Boolean(check));
          if (!checks.length) return null;
          return (
            <section className="health-group" key={group.title}>
              <div className="health-group-header">
                <h2>{group.title}</h2>
                <span>{checks.length} 项检查</span>
              </div>
              <div className="health-check-list">
                {checks.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    repairing={repairing === check.id}
                    onRepair={repair}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
