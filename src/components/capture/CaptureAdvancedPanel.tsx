"use client";

import type { Dispatch, SetStateAction } from "react";
import { Bot, ClipboardList, MonitorCog, Play, RefreshCw, Route, WandSparkles } from "lucide-react";
import type {
  ApiState,
  CaptureAuditSummary,
  ChromeStatus,
  ExtensionRunStatus,
  JobSummary,
  Platform,
  PlatformAudit,
  PlatformPreflight
} from "@/components/capture/capture-types";
import {
  CaptureStatusPanel,
  ExtensionConnectionStatus,
  ExtensionRunStatusPanel
} from "@/components/capture/CaptureStatusPanel";

type Action = () => void | Promise<void>;

type CaptureAdvancedPanelProps = {
  state: ApiState;
  chromeStatus: ChromeStatus | null;
  preflight: PlatformPreflight[];
  checkChrome: Action;
  launchChrome: Action;
  openPlatforms: Action;
  preflightPlatforms: Action;
  prepareFullCapture: Action;
  extensionInstruction: string;
  setExtensionInstruction: Dispatch<SetStateAction<string>>;
  createExtensionPlan: Action;
  createWeakEvidenceExtensionPlan: Action;
  audit: PlatformAudit[];
  extensionPlan: string;
  setExtensionPlan: Dispatch<SetStateAction<string>>;
  startExtensionCapture: Action;
  refreshExtensionStatus: Action;
  stopExtensionCapture: Action;
  resumeExtensionCapture: Action;
  clearExtensionStatus: Action;
  copyExtensionPath: Action;
  copyChromeExtensionsUrl: Action;
  extensionReady: boolean;
  extensionBridgeError: string | null;
  extensionMeta: { version?: string; buildId?: string };
  extensionCheckedAt: string | null;
  extensionDirectoryPath: string;
  chromeExtensionsUrl: string;
  extensionRun: ExtensionRunStatus | null;
  queuePlatformText: () => string | null;
  jobInstruction: string;
  setJobInstruction: Dispatch<SetStateAction<string>>;
  createJob: Action;
  refreshJobs: Action;
  refreshAudit: Action;
  batchSize: number;
  setBatchSize: Dispatch<SetStateAction<number>>;
  maxBatches: number;
  setMaxBatches: Dispatch<SetStateAction<number>>;
  batchDelaySeconds: number;
  setBatchDelaySeconds: Dispatch<SetStateAction<number>>;
  maxAttempts: number;
  setMaxAttempts: Dispatch<SetStateAction<number>>;
  runJobBatch: Action;
  runJobUntilIdle: Action;
  selectedJobId: string;
  setSelectedJobId: Dispatch<SetStateAction<string>>;
  jobs: JobSummary[];
  auditSummary: CaptureAuditSummary | null;
  agentInstruction: string;
  setAgentInstruction: Dispatch<SetStateAction<string>>;
  runAgent: (planOnly: boolean) => void | Promise<void>;
  platform: Platform;
  setPlatform: Dispatch<SetStateAction<Platform>>;
  maxItems: number;
  setMaxItems: Dispatch<SetStateAction<number>>;
  maxScrolls: number;
  setMaxScrolls: Dispatch<SetStateAction<number>>;
  discoverHistory: Action;
  instruction: string;
  setInstruction: Dispatch<SetStateAction<string>>;
  createPlan: Action;
  plan: string;
  setPlan: Dispatch<SetStateAction<string>>;
  runCapture: Action;
};

export function CaptureAdvancedPanel({
  state,
  chromeStatus,
  preflight,
  checkChrome,
  launchChrome,
  openPlatforms,
  preflightPlatforms,
  prepareFullCapture,
  extensionInstruction,
  setExtensionInstruction,
  createExtensionPlan,
  createWeakEvidenceExtensionPlan,
  audit,
  extensionPlan,
  setExtensionPlan,
  startExtensionCapture,
  refreshExtensionStatus,
  stopExtensionCapture,
  resumeExtensionCapture,
  clearExtensionStatus,
  copyExtensionPath,
  copyChromeExtensionsUrl,
  extensionReady,
  extensionBridgeError,
  extensionMeta,
  extensionCheckedAt,
  extensionDirectoryPath,
  chromeExtensionsUrl,
  extensionRun,
  queuePlatformText,
  jobInstruction,
  setJobInstruction,
  createJob,
  refreshJobs,
  refreshAudit,
  batchSize,
  setBatchSize,
  maxBatches,
  setMaxBatches,
  batchDelaySeconds,
  setBatchDelaySeconds,
  maxAttempts,
  setMaxAttempts,
  runJobBatch,
  runJobUntilIdle,
  selectedJobId,
  setSelectedJobId,
  jobs,
  auditSummary,
  agentInstruction,
  setAgentInstruction,
  runAgent,
  platform,
  setPlatform,
  maxItems,
  setMaxItems,
  maxScrolls,
  setMaxScrolls,
  discoverHistory,
  instruction,
  setInstruction,
  createPlan,
  plan,
  setPlan,
  runCapture
}: CaptureAdvancedPanelProps) {
  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--muted)]">
        高级调试与手动控制
      </summary>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <MonitorCog size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">高级备用：Chrome CDP</h2>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={checkChrome}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} strokeWidth={1.8} />
              <span>{state === "chrome" ? "检查中" : "检查连接"}</span>
            </button>
            <button
              type="button"
              onClick={launchChrome}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.8} />
              <span>{state === "chrome" ? "启动中" : "启动本地 Chrome"}</span>
            </button>
            <button
              type="button"
              onClick={openPlatforms}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Route size={16} strokeWidth={1.8} />
              <span>{state === "chrome" ? "打开中" : "打开四个平台"}</span>
            </button>
            <button
              type="button"
              onClick={preflightPlatforms}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MonitorCog size={16} strokeWidth={1.8} />
              <span>{state === "chrome" ? "预检中" : "预检四个平台"}</span>
            </button>
            <button
              type="button"
              onClick={prepareFullCapture}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <WandSparkles size={16} strokeWidth={1.8} />
              <span>{state === "chrome" ? "准备中" : "准备全量采集"}</span>
            </button>
            {chromeStatus ? (
              <div className="text-sm text-[var(--muted)]">
                {chromeStatus.ok ? "已连接" : "未连接"} · {chromeStatus.endpoint}
                {chromeStatus.browser ? ` · ${chromeStatus.browser}` : ""}
                {!chromeStatus.ok && chromeStatus.error ? ` · ${chromeStatus.error}` : ""}
              </div>
            ) : null}
          </div>
          <div className="mt-3 text-xs leading-5 text-[var(--muted)]">
            独立启动的 Chrome profile 不包含你日常浏览器的登录态。要读取已有登录 session，请把日常 Chrome
            以远程调试端口启动，或加载仓库里的 <code>extension/</code> 扩展在当前窗口采集。
          </div>
          {preflight.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {preflight.map((item) => (
                <div
                  key={item.platform}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm"
                >
                  <div className="font-semibold">{item.platform}</div>
                  <div className="mt-1 text-[var(--muted)]">
                    {item.open ? "已打开" : "未打开"}
                    {item.likelyLoggedIn === false ? " · 需要登录" : ""}
                    {item.likelyLoggedIn === true ? " · 状态正常" : ""}
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{item.title || item.hint}</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <MonitorCog size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">高级备用：Chrome 扩展采集 Agent</h2>
          </div>
          <div className="mt-3 text-xs leading-5 text-[var(--muted)]">
            这个入口会从当前 <code>/capture</code> 页面向已加载的 Chrome 扩展下发任务，扩展再在你已登录的
            Chrome 中打开 ChatGPT、Gemini、DeepSeek、通义千问并低频采集。
          </div>
          <textarea
            value={extensionInstruction}
            onChange={(event) => setExtensionInstruction(event.target.value)}
            className="mt-4 min-h-24 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={createExtensionPlan}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <WandSparkles size={16} strokeWidth={1.8} />
              <span>{state === "extension" ? "规划中" : "生成扩展计划"}</span>
            </button>
            <button
              type="button"
              onClick={createWeakEvidenceExtensionPlan}
              disabled={state !== "idle" || audit.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} strokeWidth={1.8} />
              <span>{state === "extension" ? "规划中" : "重跑弱证据平台"}</span>
            </button>
            <button
              type="button"
              onClick={startExtensionCapture}
              disabled={state !== "idle" || !extensionPlan.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.8} />
              <span>{state === "extension" ? "下发中" : "下发给扩展执行"}</span>
            </button>
            <button
              type="button"
              onClick={refreshExtensionStatus}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} strokeWidth={1.8} />
              <span>刷新扩展状态</span>
            </button>
            <button
              type="button"
              onClick={stopExtensionCapture}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,white)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>停止扩展任务</span>
            </button>
            <button
              type="button"
              onClick={resumeExtensionCapture}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>继续扩展队列</span>
            </button>
            <button
              type="button"
              onClick={clearExtensionStatus}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,white)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>清理扩展状态</span>
            </button>
            <button
              type="button"
              onClick={copyExtensionPath}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>复制扩展目录</span>
            </button>
            <button
              type="button"
              onClick={copyChromeExtensionsUrl}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>复制扩展管理页</span>
            </button>
            <div className="text-sm text-[var(--muted)]">
              {extensionReady ? "扩展 bridge 已响应" : "等待扩展 bridge。加载 extension/ 后请刷新本页。"}
            </div>
          </div>
          <ExtensionConnectionStatus
            extensionReady={extensionReady}
            extensionBridgeError={extensionBridgeError}
            extensionMeta={extensionMeta}
            extensionCheckedAt={extensionCheckedAt}
            extensionDirectoryPath={extensionDirectoryPath}
            chromeExtensionsUrl={chromeExtensionsUrl}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <textarea
              value={extensionPlan}
              onChange={(event) => setExtensionPlan(event.target.value)}
              placeholder="生成后的 ExtensionCapturePlan JSON"
              className="min-h-44 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
            />
            <ExtensionRunStatusPanel extensionRun={extensionRun} queuePlatformText={queuePlatformText} />
          </div>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">高级备用：可恢复批量任务</h2>
          </div>
          <textarea
            value={jobInstruction}
            onChange={(event) => setJobInstruction(event.target.value)}
            className="mt-4 min-h-24 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
          />
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={createJob}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ClipboardList size={16} strokeWidth={1.8} />
              <span>{state === "planning" ? "创建中" : "发现历史并创建任务"}</span>
            </button>
            <button
              type="button"
              onClick={refreshJobs}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} strokeWidth={1.8} />
              <span>刷新任务</span>
            </button>
            <button
              type="button"
              onClick={refreshAudit}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MonitorCog size={16} strokeWidth={1.8} />
              <span>刷新审计</span>
            </button>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">批次大小</span>
              <input
                type="number"
                min={1}
                max={20}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
                className="w-28 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">最大批次</span>
              <input
                type="number"
                min={1}
                max={100}
                value={maxBatches}
                onChange={(event) => setMaxBatches(Number(event.target.value))}
                className="w-28 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">间隔秒</span>
              <input
                type="number"
                min={3}
                max={120}
                value={batchDelaySeconds}
                onChange={(event) => setBatchDelaySeconds(Number(event.target.value))}
                className="w-28 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">最大尝试</span>
              <input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(Number(event.target.value))}
                className="w-28 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="button"
              onClick={runJobBatch}
              disabled={state !== "idle" || !selectedJobId}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.8} />
              <span>{state === "capturing" ? "批次执行中" : "执行下一批"}</span>
            </button>
            <button
              type="button"
              onClick={runJobUntilIdle}
              disabled={state !== "idle" || !selectedJobId}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.8} />
              <span>{state === "runningAll" ? "连续执行中" : "连续低频执行"}</span>
            </button>
          </div>
          <CaptureStatusPanel
            jobs={jobs}
            selectedJobId={selectedJobId}
            setSelectedJobId={setSelectedJobId}
            auditSummary={auditSummary}
            audit={audit}
          />
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Route size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">Agent 一键执行</h2>
          </div>
          <textarea
            value={agentInstruction}
            onChange={(event) => setAgentInstruction(event.target.value)}
            className="mt-4 min-h-28 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => runAgent(true)}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Route size={16} strokeWidth={1.8} />
              <span>{state === "agent" ? "规划中" : "只生成 Agent 计划"}</span>
            </button>
            <button
              type="button"
              onClick={() => runAgent(false)}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.8} />
              <span>{state === "agent" ? "执行中" : "执行发现、抓取并导入"}</span>
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <WandSparkles size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">自动发现历史列表</h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[180px_140px_140px_auto] sm:items-end">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">平台</span>
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value as Platform)}
                className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              >
                <option value="qwen">通义千问</option>
                <option value="chatgpt">ChatGPT</option>
                <option value="gemini">Gemini</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">最多条数</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxItems}
                onChange={(event) => setMaxItems(Number(event.target.value))}
                className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">滚动屏数</span>
              <input
                type="number"
                min={0}
                max={200}
                value={maxScrolls}
                onChange={(event) => setMaxScrolls(Number(event.target.value))}
                className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="button"
              onClick={discoverHistory}
              disabled={state !== "idle"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <WandSparkles size={16} strokeWidth={1.8} />
              <span>{state === "planning" ? "发现中" : "发现并生成计划"}</span>
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2">
            <Bot size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">LLM 抓取计划</h2>
          </div>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            className="mt-4 min-h-48 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={createPlan}
            disabled={state !== "idle"}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <WandSparkles size={16} strokeWidth={1.8} />
            <span>{state === "planning" ? "生成中" : "生成计划"}</span>
          </button>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2">
            <Play size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">执行采集</h2>
          </div>
          <textarea
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            placeholder="生成或粘贴 CapturePlan JSON"
            className="mt-4 min-h-48 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={runCapture}
            disabled={state !== "idle" || !plan.trim()}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play size={16} strokeWidth={1.8} />
            <span>{state === "capturing" ? "采集中" : "执行并导入"}</span>
          </button>
        </section>
      </div>
    </details>
  );
}
