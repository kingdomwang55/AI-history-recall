"use client";

import { Bot, Check, ChevronRight, Copy, Pause, Play, RefreshCw } from "lucide-react";
import type { ApiState, CaptureAuditSummary, ExtensionRunStatus, Platform, PlatformAudit } from "@/components/capture/capture-types";

const platformOrder: Platform[] = ["chatgpt", "gemini", "deepseek", "qwen"];
const platformLabels: Record<Platform, string> = { chatgpt: "ChatGPT", gemini: "Gemini", deepseek: "DeepSeek", qwen: "通义千问" };

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function CaptureGuidePanel({
  state, assistantMessage, assistantSteps, extensionReady, extensionMeta, extensionRun, audit, auditSummary,
  extensionDirectoryPath, expectedExtensionVersion, topStatusLabel, guidedButtonLabel, runProgressPercent,
  queuePlatformText, currentCaptureLine, isExtensionOutdated, runGuidedExtensionFlow, toggleBackgroundSync,
  copyChromeExtensionsUrl, copyExtensionPath
}: {
  state: ApiState; assistantMessage: string; assistantSteps: string[]; extensionReady: boolean;
  extensionMeta: { version?: string; buildId?: string }; extensionRun: ExtensionRunStatus | null;
  audit: PlatformAudit[]; auditSummary: CaptureAuditSummary | null; extensionDirectoryPath: string;
  expectedExtensionVersion: string; topStatusLabel: () => string; guidedButtonLabel: () => string;
  runProgressPercent: () => number; queuePlatformText: () => string | null; currentCaptureLine: () => string | null;
  isExtensionOutdated: () => boolean; runGuidedExtensionFlow: () => void; toggleBackgroundSync: () => void;
  copyChromeExtensionsUrl: () => void; copyExtensionPath: () => void;
}) {
  const running = extensionRun?.status === "running";
  const backgroundSyncEnabled = extensionRun?.backgroundSync?.enabled === true;

  return (
    <section className="panel overflow-hidden lg:col-span-2">
      <div className="flex flex-col gap-4 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">增量同步</h2>
            <span className={`inline-flex items-center gap-2 text-xs font-medium ${extensionReady ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
              <span className={`status-dot ${extensionReady ? "status-dot-success" : "status-dot-warning"}`} />{topStatusLabel()}
            </span>
            {extensionMeta.version ? <span className="text-xs text-[var(--muted)]">Chrome 扩展 v{extensionMeta.version}</span> : null}
          </div>
          <p className="mt-1.5 text-sm text-[var(--muted)]">低频发现各平台新增对话，相同会话只追加新消息，数据仅保存在本机。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {extensionReady ? (
            <button type="button" onClick={toggleBackgroundSync} disabled={state !== "idle"} className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-60">
              {backgroundSyncEnabled ? <Pause size={15} /> : <Play size={15} />}
              {backgroundSyncEnabled ? "暂停后台同步" : "开启后台同步"}
            </button>
          ) : null}
          <button type="button" onClick={runGuidedExtensionFlow} disabled={state !== "idle"} className="inline-flex h-10 items-center gap-2 rounded-[5px] bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
            <RefreshCw size={16} className={state === "extension" ? "animate-spin" : ""} />{guidedButtonLabel()}
          </button>
        </div>
      </div>

      <div className={`border-b border-[var(--line)] px-5 py-3 text-sm ${extensionReady ? "bg-[var(--primary-soft)]" : "bg-[var(--warning-soft)]"}`}>
        <div className="flex items-start gap-3"><Bot className="mt-0.5 shrink-0 text-[var(--accent)]" size={17} /><div className="min-w-0"><div className="font-medium">{assistantMessage}</div><div className="mt-1 text-xs text-[var(--muted)]">每个平台最多检查最近 50 条，连续 10 条已存在时提前停止；失败后自动退避。</div></div></div>
        {running ? (
          <div className="mt-3 ml-7 max-w-3xl">
            <div className="flex justify-between text-xs text-[var(--muted)]"><span>{currentCaptureLine() ?? "后台低频采集"}</span><span>{extensionRun.processed ?? 0}/{extensionRun.totalTargets ?? 0}</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-[var(--surface)]"><div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${runProgressPercent()}%` }} /></div>
            {queuePlatformText() ? <div className="mt-1.5 text-xs text-[var(--muted)]">队列：{queuePlatformText()}</div> : null}
          </div>
        ) : null}
        {isExtensionOutdated() && !running ? <div className="mt-3 ml-7 text-xs leading-5 text-[var(--muted)]">扩展版本较旧。到 <b>chrome://extensions</b> 对 AI History Recall Capture 点击重新加载，系统会自动连接 v{expectedExtensionVersion}。目录：{extensionDirectoryPath}</div> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="platform-status-matrix min-w-[760px]">
          <thead><tr><th>平台</th><th>状态</th><th>最近同步</th><th>本次新增</th><th>索引概况</th></tr></thead>
          <tbody>
            {platformOrder.map((platform) => {
              const item = audit.find((entry) => entry.platform === platform);
              const connected = extensionRun?.connectedPlatforms?.includes(platform) ?? false;
              const syncing = running && extensionRun?.platforms?.includes(platform);
              const hasError = Boolean(item?.syncState.lastError);
              return (
                <tr key={platform}>
                  <td><div className="font-semibold">{platformLabels[platform]}</div></td>
                  <td><span className="inline-flex items-center gap-2 text-xs"><span className={`status-dot ${hasError ? "status-dot-danger" : syncing || connected ? "status-dot-success" : ""}`} />{hasError ? "需要处理" : syncing ? "正在同步" : connected ? "页面已连接" : "等待访问"}</span></td>
                  <td><div className="text-xs tabular-nums">{syncing ? "同步进行中" : formatSyncTime(item?.syncState.lastSyncedAt)}</div>{item?.syncState.lastError ? <div className="mt-1 max-w-48 truncate text-[11px] text-[var(--danger)]" title={item.syncState.lastError}>{item.syncState.lastError}</div> : null}</td>
                  <td><div className="text-xs tabular-nums">对话 {item?.syncState.lastNewConversations ?? 0}</div><div className="mt-1 text-xs tabular-nums text-[var(--muted)]">消息 {item?.syncState.lastNewMessages ?? 0}</div></td>
                  <td><div className="text-xs tabular-nums">{item?.importedConversations ?? 0} 对话</div><div className="mt-1 text-xs tabular-nums text-[var(--muted)]">{item?.indexedMessages ?? 0} 条已索引</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid border-t border-[var(--line)] lg:grid-cols-2 lg:divide-x lg:divide-[var(--line)]">
        <section className="p-5">
          <h3 className="text-sm font-semibold">最近同步活动</h3>
          <div className="mt-4 space-y-4">
            {audit.length ? audit.slice(0, 4).map((item) => (
              <div key={item.platform} className="flex gap-3 text-xs">
                <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"><Check size={12} /></span>
                <div className="min-w-0"><div><span className="font-semibold">{platformLabels[item.platform]}</span><span className="ml-2 text-[var(--muted)]">{formatSyncTime(item.syncState.lastSyncedAt)}</span></div><div className="mt-1 text-[var(--muted)]">新增对话 {item.syncState.lastNewConversations}，新增消息 {item.syncState.lastNewMessages}</div></div>
              </div>
            )) : <div className="text-xs text-[var(--muted)]">正在读取本地同步状态...</div>}
          </div>
          {auditSummary ? <div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">{auditSummary.readyForReview ? "本地审计已就绪，数据可以搜索和复核。" : auditSummary.nextAction}</div> : null}
        </section>

        <section className="border-t border-[var(--line)] p-5 lg:border-t-0">
          <h3 className="text-sm font-semibold">首次使用设置</h3>
          <ol className="mt-4 space-y-4 text-xs">
            {[{ title: "安装并启用 Chrome 扩展", done: extensionReady, detail: "加载项目中的 extension 目录。" }, { title: "连接当前浏览器", done: extensionReady, detail: "扩展会复用你已登录的平台会话。" }, { title: "执行首次同步", done: Boolean(auditSummary?.totals.importedConversations), detail: "点击“同步新增”，后续会自动增量同步。" }].map((step, index) => (
              <li key={step.title} className="flex gap-3"><span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${step.done ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line-strong)] text-[var(--muted)]"}`}>{step.done ? <Check size={12} /> : index + 1}</span><div><div className="font-medium">{step.title}</div><div className="mt-1 text-[var(--muted)]">{step.detail}</div></div></li>
            ))}
          </ol>
          {!extensionReady ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={copyChromeExtensionsUrl} className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"><Copy size={13} />复制扩展页</button><button type="button" onClick={copyExtensionPath} className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"><Copy size={13} />复制目录</button></div> : null}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-tertiary)] px-5 py-3 text-xs text-[var(--muted)]">
        {["打开 AI 对话", "延迟快照", "本地合并", "全文可搜索"].map((step, index) => <span key={step} className="inline-flex items-center gap-2"><span className="font-medium text-[var(--foreground)]">{step}</span>{index < 3 ? <ChevronRight size={13} /> : null}</span>)}
      </div>
      {assistantSteps.length ? <details className="border-t border-[var(--line)] px-5 py-4"><summary className="cursor-pointer text-xs font-semibold">本次执行记录</summary><ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">{assistantSteps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol></details> : null}
    </section>
  );
}
