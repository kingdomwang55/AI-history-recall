"use client";

import { Bot, WandSparkles } from "lucide-react";
import type { ApiState, CaptureAuditSummary, ExtensionRunStatus } from "@/components/capture/capture-types";

export function CaptureGuidePanel({
  state,
  assistantMessage,
  assistantSteps,
  extensionReady,
  extensionMeta,
  extensionRun,
  auditSummary,
  extensionDirectoryPath,
  expectedExtensionVersion,
  topStatusLabel,
  guidedButtonLabel,
  runProgressPercent,
  queuePlatformText,
  currentCaptureLine,
  isExtensionOutdated,
  runGuidedExtensionFlow,
  copyChromeExtensionsUrl,
  copyExtensionPath
}: {
  state: ApiState;
  assistantMessage: string;
  assistantSteps: string[];
  extensionReady: boolean;
  extensionMeta: { version?: string; buildId?: string };
  extensionRun: ExtensionRunStatus | null;
  auditSummary: CaptureAuditSummary | null;
  extensionDirectoryPath: string;
  expectedExtensionVersion: string;
  topStatusLabel: () => string;
  guidedButtonLabel: () => string;
  runProgressPercent: () => number;
  queuePlatformText: () => string | null;
  currentCaptureLine: () => string | null;
  isExtensionOutdated: () => boolean;
  runGuidedExtensionFlow: () => void;
  copyChromeExtensionsUrl: () => void;
  copyExtensionPath: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] lg:col-span-2">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Bot size={20} strokeWidth={1.8} className="text-[var(--accent)]" />
                <h2 className="text-xl font-semibold">采集向导</h2>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                一个入口处理安装检查、审计判断、弱证据重跑和后台采集。扩展连接后，未完成的采集会自动接管推进。
              </p>
            </div>
            <div className="rounded-full border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
              {topStatusLabel()}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-sm">
            <div className="font-semibold text-[var(--foreground)]">{assistantMessage}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-md bg-[var(--surface)] px-2 py-1">
                {extensionReady ? "扩展已连接" : "扩展未连接"}
              </span>
              {extensionMeta.version || extensionMeta.buildId ? (
                <span className="rounded-md bg-[var(--surface)] px-2 py-1">
                  v{extensionMeta.version ?? "unknown"} / {extensionMeta.buildId ?? "unknown-build"}
                </span>
              ) : null}
              {extensionRun?.status ? (
                <span className="rounded-md bg-[var(--surface)] px-2 py-1">
                  {extensionRun.status} / {extensionRun.phase ?? "unknown"}
                </span>
              ) : null}
              {auditSummary ? (
                <span className="rounded-md bg-[var(--surface)] px-2 py-1">
                  {auditSummary.readyForReview ? "审计就绪" : "审计未就绪"}
                </span>
              ) : null}
            </div>
            {extensionRun?.status === "running" ? (
              <div className="mt-4 text-xs leading-5 text-[var(--muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span>后台低频采集</span>
                  <span>
                    {extensionRun.processed ?? 0}/{extensionRun.totalTargets ?? 0}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all"
                    style={{ width: `${runProgressPercent()}%` }}
                  />
                </div>
                {queuePlatformText() ? <div className="mt-2">队列分布：{queuePlatformText()}</div> : null}
                {currentCaptureLine() ? <div className="mt-2">{currentCaptureLine()}</div> : null}
              </div>
            ) : null}
            {auditSummary?.readyForReview ? (
              <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--muted)]">
                本地审计已就绪。可以打开搜索页使用数据，或人工抽查平台历史列表后确认完成。
              </div>
            ) : null}
            {isExtensionOutdated() ? (
              <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--muted)]">
                {extensionRun?.status === "running" ? (
                  <>旧版扩展仍在完成当前队列。结束后再连接新版，避免中断已经开始的采集。</>
                ) : (
                  <>
                    <div className="font-semibold text-[var(--foreground)]">只需重新载入一次扩展</div>
                    <div className="mt-1">
                      在 Chrome 地址栏输入 <code>chrome://extensions</code>，找到 <b>AI History Recall Capture</b>，
                      点击卡片上的 ↻。然后回到本页，系统会自动连接 v{expectedExtensionVersion} 并继续采集，无需刷新页面或再次点开始。
                    </div>
                    <div className="mt-2 truncate text-[var(--muted)]" title={extensionDirectoryPath}>
                      加载目录：{extensionDirectoryPath}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 text-xs text-[var(--muted)] sm:grid-cols-5">
            {["检查扩展", "读取审计", "选择平台", "后台采集", "自动验收"].map((step, index) => (
              <div key={step} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-subtle)] font-semibold text-[var(--foreground)]">
                  {index + 1}
                </div>
                <div className="font-medium text-[var(--foreground)]">{step}</div>
              </div>
            ))}
          </div>

          {!extensionReady ? (
            <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">
              <div className="font-semibold text-[var(--foreground)]">首次设置只要三步</div>
              <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                <li>
                  <div className="font-medium text-[var(--foreground)]">打开扩展页</div>
                  <div className="mt-1">在 Chrome 开启 Developer mode。</div>
                </li>
                <li>
                  <div className="font-medium text-[var(--foreground)]">加载本地扩展</div>
                  <div className="mt-1">Load unpacked 选择本项目的 extension 目录。</div>
                </li>
                <li>
                  <div className="font-medium text-[var(--foreground)]">回到本页开始</div>
                  <div className="mt-1">看到扩展已连接后，点击主按钮即可。</div>
                </li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyChromeExtensionsUrl}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-subtle)]"
                >
                  复制扩展页
                </button>
                <button
                  type="button"
                  onClick={copyExtensionPath}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-subtle)]"
                >
                  复制目录
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="border-t border-[var(--line)] bg-[var(--surface-subtle)] p-5 lg:border-l lg:border-t-0 sm:p-6">
          <button
            type="button"
            onClick={runGuidedExtensionFlow}
            disabled={state !== "idle"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            <WandSparkles size={18} strokeWidth={1.8} />
            <span>{guidedButtonLabel()}</span>
          </button>
          <div className="mt-4 text-xs leading-5 text-[var(--muted)]">
            自动接管已开启。采集会按平台排队执行，滚动和点击都做了低频控制。任务进行中不要重复下发，页面会自动轮询状态。
          </div>
          <details className="mt-4 text-xs text-[var(--muted)]">
            <summary className="cursor-pointer font-medium text-[var(--foreground)]">没有反应时怎么办</summary>
            <div className="mt-2 leading-5">
              先看左侧状态。如果扩展未连接，到 Chrome 扩展页确认它已启用；如果任务已在运行，等待自动进度即可；如果旧任务停止，再点主按钮会自动继续或重新规划。
            </div>
          </details>
        </aside>
      </div>

      {assistantSteps.length > 0 ? (
        <details className="border-t border-[var(--line)] bg-[var(--surface-subtle)] p-5">
          <summary className="cursor-pointer text-sm font-semibold">本次执行记录</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">
            {assistantSteps.map((step, index) => (
              <li key={`${step}-${index}`}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
