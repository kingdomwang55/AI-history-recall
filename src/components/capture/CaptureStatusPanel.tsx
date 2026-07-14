"use client";

import type {
  CaptureAuditSummary,
  ExtensionRunStatus,
  JobSummary,
  PlatformAudit
} from "@/components/capture/capture-types";

export function ExtensionConnectionStatus({
  extensionReady,
  extensionBridgeError,
  extensionMeta,
  extensionCheckedAt,
  extensionDirectoryPath,
  chromeExtensionsUrl
}: {
  extensionReady: boolean;
  extensionBridgeError: string | null;
  extensionMeta: { version?: string; buildId?: string };
  extensionCheckedAt: string | null;
  extensionDirectoryPath: string;
  chromeExtensionsUrl: string;
}) {
  return (
    <div
      className={`mt-4 rounded-lg border p-4 text-sm ${
        extensionReady
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="font-semibold">{extensionReady ? "扩展已连接" : "扩展未连接"}</div>
      <div className="mt-2 text-xs leading-5">
        {extensionReady
          ? "当前页面已经检测到 AI History Recall Chrome 扩展，可以从应用页面下发采集任务。"
          : "当前页面没有检测到 AI History Recall Chrome 扩展。请打开 chrome://extensions，开启 Developer mode，Load unpacked 选择本项目 extension/ 目录；如果已经加载过，请点击该扩展卡片上的 Reload，然后刷新本页面。"}
      </div>
      <div className="mt-2 font-mono text-xs">{extensionDirectoryPath}</div>
      <div className="mt-1 font-mono text-xs">{chromeExtensionsUrl}</div>
      {!extensionReady ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5">
          <li>Chrome 扩展页中 AI History Recall Capture 必须是 Enabled。</li>
          <li>修改 manifest 或脚本后必须点扩展卡片上的 Reload。</li>
          <li>刷新本页后这里必须变成“扩展已连接”，再下发采集任务。</li>
        </ol>
      ) : null}
      {extensionBridgeError ? <div className="mt-2 text-xs">{extensionBridgeError}</div> : null}
      {extensionMeta.version || extensionMeta.buildId ? (
        <div className="mt-2 font-mono text-xs opacity-75">
          extension v{extensionMeta.version ?? "unknown"} / {extensionMeta.buildId ?? "unknown-build"}
        </div>
      ) : null}
      {extensionCheckedAt ? (
        <div className="mt-2 text-xs opacity-75">checked {new Date(extensionCheckedAt).toLocaleString()}</div>
      ) : null}
    </div>
  );
}

export function ExtensionRunStatusPanel({
  extensionRun,
  queuePlatformText
}: {
  extensionRun: ExtensionRunStatus | null;
  queuePlatformText: () => string | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-sm">
      <div className="font-semibold">扩展运行状态</div>
      {extensionRun ? (
        <div className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
          {extensionRun.extensionVersion || extensionRun.extensionBuildId ? (
            <div>
              extension v{extensionRun.extensionVersion ?? "unknown"} /{" "}
              {extensionRun.extensionBuildId ?? "unknown-build"}
            </div>
          ) : null}
          <div>
            {extensionRun.status ?? "unknown"} / {extensionRun.phase ?? "unknown"}
          </div>
          <div>
            progress {extensionRun.processed ?? 0}/{extensionRun.totalTargets ?? 0}
          </div>
          {queuePlatformText() ? <div>queue platforms {queuePlatformText()}</div> : null}
          <div>
            queue {extensionRun.nextIndex ?? 0}/{extensionRun.totalTargets ?? 0}
            {extensionRun.processing ? " · processing" : ""}
          </div>
          {extensionRun.currentTarget ? (
            <div className="rounded-md border border-[var(--line)] bg-[var(--background)] p-2">
              <div>
                current {extensionRun.currentTarget.platform ?? "unknown"}{" "}
                {extensionRun.currentTarget.index ?? "?"}/{extensionRun.currentTarget.total ?? "?"}
              </div>
              {extensionRun.currentTarget.title ? (
                <div className="truncate">{extensionRun.currentTarget.title}</div>
              ) : null}
              {extensionRun.currentTarget.url ? (
                <div className="truncate font-mono">{extensionRun.currentTarget.url}</div>
              ) : null}
            </div>
          ) : null}
          <div>
            imported {extensionRun.importedConversations ?? 0} conv · {extensionRun.importedMessages ?? 0} msg
          </div>
          {extensionRun.discoveryProgress ? (
            <div className="rounded-md border border-[var(--line)] bg-[var(--background)] p-2">
              <div>
                discovery {extensionRun.discoveryProgress.platform ?? "unknown"} /{" "}
                {extensionRun.discoveryProgress.phase ?? "unknown"}
              </div>
              {typeof extensionRun.discoveryProgress.platformIndex === "number" ? (
                <div>
                  platform {extensionRun.discoveryProgress.platformIndex}/
                  {extensionRun.discoveryProgress.totalPlatforms ?? "?"}
                </div>
              ) : null}
              <div>
                targets {extensionRun.discoveryProgress.targetsFound ?? 0} · scanned{" "}
                {extensionRun.discoveryProgress.scannedTitles ?? 0} · failures{" "}
                {extensionRun.discoveryProgress.failures ?? 0}
              </div>
              {typeof extensionRun.discoveryProgress.scrollIndex === "number" ? (
                <div>
                  scroll {extensionRun.discoveryProgress.scrollIndex + 1}/
                  {extensionRun.discoveryProgress.maxScrolls ?? "?"}
                </div>
              ) : null}
              {extensionRun.discoveryProgress.currentTitle ? (
                <div className="truncate">current {extensionRun.discoveryProgress.currentTitle}</div>
              ) : null}
              {extensionRun.discoveryProgress.stopReason ? (
                <div>stop {extensionRun.discoveryProgress.stopReason}</div>
              ) : null}
              {extensionRun.discoveryProgress.error ? (
                <div className="text-red-600">{extensionRun.discoveryProgress.error}</div>
              ) : null}
            </div>
          ) : null}
          <div>duplicates {extensionRun.skippedDuplicates ?? 0}</div>
          <div>failures {extensionRun.failures?.length ?? 0}</div>
          {extensionRun.error ? <div>{extensionRun.error}</div> : null}
        </div>
      ) : (
        <div className="mt-3 text-xs text-[var(--muted)]">暂无运行状态。</div>
      )}
    </div>
  );
}

export function CaptureStatusPanel({
  jobs,
  selectedJobId,
  setSelectedJobId,
  auditSummary,
  audit
}: {
  jobs: JobSummary[];
  selectedJobId: string;
  setSelectedJobId: (id: string) => void;
  auditSummary: CaptureAuditSummary | null;
  audit: PlatformAudit[];
}) {
  return (
    <>
      {jobs.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--line)]">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelectedJobId(job.id)}
              className={`grid w-full gap-2 border-b border-[var(--line)] px-4 py-3 text-left text-sm last:border-b-0 ${
                selectedJobId === job.id ? "bg-[var(--surface-subtle)]" : "bg-[var(--surface)]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{job.status}</span>
                <span className="text-[var(--muted)]">{job.totalTargets} targets</span>
                <span className="text-[var(--muted)]">updated {new Date(job.updatedAt).toLocaleString()}</span>
              </div>
              <div className="line-clamp-1 text-[var(--muted)]">{job.instruction}</div>
              <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span>pending {job.counts.pending}</span>
                <span>succeeded {job.counts.succeeded}</span>
                <span>failed {job.counts.failed}</span>
                <span>running {job.counts.running}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
      {auditSummary ? (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            auditSummary.readyForReview
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="font-semibold">
            {auditSummary.readyForReview ? "本地审计已就绪，可人工复核" : "本地审计未就绪"}
          </div>
          <div className="mt-1 text-xs leading-5">{auditSummary.nextAction}</div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs opacity-80">
            <span>{auditSummary.totals.importedConversations} conv</span>
            <span>{auditSummary.totals.importedMessages} msg</span>
            <span>{auditSummary.totals.indexedMessages} idx</span>
            <span>pending {auditSummary.totals.pendingTargets}</span>
            <span>failed {auditSummary.totals.failedTargets}</span>
          </div>
        </div>
      ) : null}
      {audit.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {audit.map((item) => (
            <div key={item.platform} className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{item.platform}</span>
                <span className="text-xs text-[var(--muted)]">{item.status}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--muted)]">
                <span>{item.importedConversations} conv</span>
                <span>{item.importedMessages} msg</span>
                <span>{item.indexedMessages} idx</span>
              </div>
              <div className="mt-2 text-xs text-[var(--muted)]">
                pending {item.targetCounts.pending + item.targetCounts.running} · failed {item.targetCounts.failed}
              </div>
              <div className="mt-2 text-xs text-[var(--muted)]">
                发现{" "}
                {item.latestDiscovery
                  ? `${item.latestDiscovery.stopReason ?? "unknown"} · targets ${item.latestDiscovery.targetsFound} · scanned ${item.latestDiscovery.scannedTitlesCount} · failures ${item.latestDiscovery.failuresCount}`
                  : "缺失"}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {item.latestDiscovery?.evidenceStrong
                  ? "已有强耗尽证据"
                  : item.latestDiscovery?.exhausted
                    ? "耗尽证据偏弱"
                    : "暂无耗尽证据"}
              </div>
              <div className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{item.hint}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
