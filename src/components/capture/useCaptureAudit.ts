"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/capture/apiFetch";
import type { CaptureAuditSummary, Platform, PlatformAudit } from "@/components/capture/capture-types";

export function weakEvidencePlatforms(platforms: PlatformAudit[]) {
  return platforms
    .filter(
      (item) =>
        item.importedConversations > 0 &&
        (item.latestDiscovery?.evidenceStrong !== true || (item.latestDiscovery?.failuresCount ?? 0) > 0)
    )
    .map((item) => item.platform);
}

export function missingOrWeakPlatforms(platforms: PlatformAudit[]) {
  const selected = platforms
    .filter(
      (item) =>
        item.importedConversations === 0 ||
        item.latestDiscovery?.evidenceStrong !== true ||
        (item.latestDiscovery?.failuresCount ?? 0) > 0
    )
    .map((item) => item.platform);

  return selected.length > 0 ? selected : (["chatgpt", "gemini", "deepseek", "qwen"] as Platform[]);
}

export function useCaptureAudit({ setResult }: { setResult: (value: string) => void }) {
  const [audit, setAudit] = useState<PlatformAudit[]>([]);
  const [auditSummary, setAuditSummary] = useState<CaptureAuditSummary | null>(null);

  const loadCaptureAudit = useCallback(async () => {
    const response = await apiFetch("/api/capture/audit");
    const data = await response.json();
    const platforms = (data.audit?.platforms ?? []) as PlatformAudit[];
    const summary = data.audit ? (data.audit as CaptureAuditSummary) : null;
    setAudit(platforms);
    setAuditSummary(summary);
    return { data, platforms, summary };
  }, []);

  const refreshAudit = useCallback(async () => {
    setResult("");
    try {
      const { data } = await loadCaptureAudit();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "刷新采集审计失败");
    }
  }, [loadCaptureAudit, setResult]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCaptureAudit().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCaptureAudit]);

  return {
    audit,
    auditSummary,
    loadCaptureAudit,
    refreshAudit,
    weakEvidencePlatforms,
    missingOrWeakPlatforms
  };
}
