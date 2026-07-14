"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ClipboardList, MonitorCog, Play, RefreshCw, Route, WandSparkles } from "lucide-react";
import { withApiToken } from "@/lib/client-api";

type ApiState = "idle" | "planning" | "capturing" | "runningAll" | "agent" | "chrome" | "extension";
type Platform = "chatgpt" | "gemini" | "deepseek" | "qwen";

const defaultInstruction = `抓取这些历史对话并导入本地：
https://chatgpt.com/c/...
https://gemini.google.com/app/...
https://chat.deepseek.com/a/chat/s/...
https://www.qianwen.com/chat/...`;

const defaultAgentInstruction = "发现并导入通义千问最近 10 条历史对话，低频滚动，避免触发限流。";
const defaultJobInstruction = "发现 ChatGPT、Gemini、DeepSeek、通义千问全部历史对话，创建可恢复采集任务。";
const defaultExtensionInstruction =
  "通过我当前已登录的 Chrome 扩展，低频抓取 ChatGPT、Gemini、DeepSeek、通义千问的全部历史对话。";
const extensionDirectoryPath = process.env.NEXT_PUBLIC_AIHR_EXTENSION_PATH || "extension";
const chromeExtensionsUrl = "chrome://extensions/";
const expectedExtensionVersion = "0.1.38";
const expectedExtensionBuildId = "no-debugger-input-20260711";
const autoPilotLockKey = "aihr:capture:auto-pilot-lock";
const tabInstanceKey = "aihr:capture:tab-instance";
const autoPilotLockTtlMs = 120000;

function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: withApiToken(init?.headers)
  });
}

function getTabInstanceId() {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem(tabInstanceKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(tabInstanceKey, id);
  return id;
}

function extensionNeedsUpdate(version?: string, buildId?: string) {
  if (!version) return false;
  const current = version.split(".").map((part) => Number(part) || 0);
  const expected = expectedExtensionVersion.split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(current.length, expected.length); index += 1) {
    const difference = (current[index] || 0) - (expected[index] || 0);
    if (difference < 0) return true;
    if (difference > 0) return false;
  }
  return buildId !== expectedExtensionBuildId;
}

type JobSummary = {
  id: string;
  instruction: string;
  status: string;
  updatedAt: string;
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  totalTargets: number;
};

type ChromeStatus = {
  ok: boolean;
  endpoint: string;
  browser: string | null;
  error: string | null;
};

type PlatformPreflight = {
  platform: Platform;
  open: boolean;
  title: string | null;
  url: string | null;
  likelyLoggedIn: boolean | null;
  hint: string;
};

type PlatformAudit = {
  platform: Platform;
  importedConversations: number;
  importedMessages: number;
  indexedMessages: number;
  latestImportedAt: string | null;
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
  status: string;
  hint: string;
  targetCounts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
};

type CaptureAuditSummary = {
  locallyConsistent: boolean;
  readyForReview: boolean;
  nextAction: string;
  completionNote: string;
  totals: {
    importedConversations: number;
    importedMessages: number;
    indexedMessages: number;
    pendingTargets: number;
    failedTargets: number;
  };
};

type ExtensionRunStatus = {
  status?: string;
  phase?: string;
  extensionVersion?: string;
  extensionBuildId?: string;
  platform?: string;
  platforms?: Platform[];
  totalTargets?: number;
  processed?: number;
  nextIndex?: number;
  processing?: boolean;
  queue?: unknown[];
  queuePlatformCounts?: Partial<Record<Platform | "unknown", number>>;
  currentTarget?: {
    platform?: Platform;
    title?: string;
    url?: string;
    index?: number;
    total?: number;
  } | null;
  importedConversations?: number;
  importedMessages?: number;
  skippedDuplicates?: number;
  discoveryProgress?: {
    platform?: Platform;
    phase?: string;
    scrollIndex?: number;
    maxScrolls?: number;
    currentTitle?: string;
    platformIndex?: number;
    totalPlatforms?: number;
    targetsFound?: number;
    scannedTitles?: number;
    failures?: number;
    scrollBefore?: number;
    scrollAfter?: number;
    scrollTarget?: number;
    scrollMoved?: boolean;
    scrollAtEnd?: boolean;
    stopReason?: string;
    error?: string;
    updatedAt?: string;
  };
  failures?: Array<{ platform?: string; url?: string; title?: string; error: string }>;
  discoveries?: Array<{ platform: Platform; targets?: unknown[]; stopReason?: string }>;
  error?: string;
};

export function CapturePlanner() {
  const autoPilotStartedRef = useRef(false);
  const extensionReloadRequestedRef = useRef(false);
  const tabInstanceIdRef = useRef<string>(getTabInstanceId());
  const runGuidedExtensionFlowRef = useRef<() => void>(() => undefined);
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [plan, setPlan] = useState("");
  const [result, setResult] = useState("");
  const [state, setState] = useState<ApiState>("idle");
  const [platform, setPlatform] = useState<Platform>("qwen");
  const [maxItems, setMaxItems] = useState(100);
  const [maxScrolls, setMaxScrolls] = useState(20);
  const [agentInstruction, setAgentInstruction] = useState(defaultAgentInstruction);
  const [jobInstruction, setJobInstruction] = useState(defaultJobInstruction);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [batchSize, setBatchSize] = useState(5);
  const [maxBatches, setMaxBatches] = useState(10);
  const [batchDelaySeconds, setBatchDelaySeconds] = useState(12);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null);
  const [preflight, setPreflight] = useState<PlatformPreflight[]>([]);
  const [audit, setAudit] = useState<PlatformAudit[]>([]);
  const [auditSummary, setAuditSummary] = useState<CaptureAuditSummary | null>(null);
  const [extensionInstruction, setExtensionInstruction] = useState(defaultExtensionInstruction);
  const [extensionPlan, setExtensionPlan] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionMeta, setExtensionMeta] = useState<{ version?: string; buildId?: string }>({});
  const [extensionCheckedAt, setExtensionCheckedAt] = useState<string | null>(null);
  const [extensionBridgeError, setExtensionBridgeError] = useState<string | null>(null);
  const [extensionRun, setExtensionRun] = useState<ExtensionRunStatus | null>(null);
  const [assistantMessage, setAssistantMessage] = useState(
    "点击主按钮，系统会自动判断下一步，不需要记操作顺序。"
  );
  const [assistantSteps, setAssistantSteps] = useState<string[]>([]);
  const [autoPilotRetryTick, setAutoPilotRetryTick] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== "aihr-extension") return;
      if (event.data.type === "AIHR_EXTENSION_READY") {
        setExtensionReady(true);
        setExtensionMeta({ version: event.data.version, buildId: event.data.buildId });
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
      }
      if (event.data.type === "AIHR_WEB_STATUS_RESULT") {
        setExtensionReady(true);
        setExtensionMeta({ version: event.data.version, buildId: event.data.buildId });
        setExtensionRun(event.data.run ?? null);
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aihr-web", type: "AIHR_WEB_GET_STATUS", requestId: crypto.randomUUID() },
      window.location.origin
    );
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    apiFetch("/api/capture/audit")
      .then((response) => response.json())
      .then((data) => {
        setAudit((data.audit?.platforms ?? []) as PlatformAudit[]);
        setAuditSummary(data.audit ? (data.audit as CaptureAuditSummary) : null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!extensionReady) return;

    let disposed = false;
    const timer = window.setInterval(() => {
      requestExtension<{ run?: ExtensionRunStatus }>(
        {
          type: "AIHR_WEB_GET_STATUS"
        },
        4000
      )
        .then((response) => {
          if (disposed) return;
          const run = response.run ?? null;
          setExtensionRun(run);

          if (run?.status === "completed") {
            autoPilotStartedRef.current = false;
            setAssistantMessage("后台采集已完成，正在自动更新审计结果。");
            void loadCaptureAudit();
          }

          if (run?.status === "failed") {
            autoPilotStartedRef.current = false;
            setAssistantMessage("后台采集失败，已自动读取状态；可以展开高级调试看错误详情。");
            void loadCaptureAudit();
          }

          if (run?.status === "stopped") {
            setAssistantMessage("后台采集已停止。再次点击一键向导会自动继续可恢复队列或重新规划。");
            void loadCaptureAudit();
          }
        })
        .catch(() => undefined);
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [extensionReady]);

  useEffect(() => {
    if (autoPilotStartedRef.current) return;
    if (!extensionReady || !auditSummary) return;
    if (state !== "idle") return;
    if (auditSummary.readyForReview) return;
    if (extensionRun?.status === "running") return;
    const outdated = extensionNeedsUpdate(extensionMeta.version, extensionMeta.buildId);
    if (outdated) return;
    if (!tryAcquireAutoPilotLock()) {
      const retryTimer = window.setTimeout(() => {
        setAssistantMessage("另一个采集页已经接管了后台任务。本页会继续自动同步状态。");
        setAutoPilotRetryTick((value) => value + 1);
      }, 3000);
      return () => window.clearTimeout(retryTimer);
    }

    autoPilotStartedRef.current = true;
    window.setTimeout(() => {
      setAssistantMessage("检测到本地审计未就绪，已自动接管下一步。");
      runGuidedExtensionFlowRef.current();
    }, 0);
  }, [
    auditSummary,
    autoPilotRetryTick,
    extensionMeta.buildId,
    extensionMeta.version,
    extensionReady,
    extensionRun?.status,
    state
  ]);

  useEffect(() => {
    const outdated = extensionReady && extensionNeedsUpdate(extensionMeta.version, extensionMeta.buildId);
    if (!outdated || extensionRun?.status === "running") return;

    const reconnect = () => window.location.reload();
    window.addEventListener("focus", reconnect, { once: true });
    return () => window.removeEventListener("focus", reconnect);
  }, [extensionMeta.buildId, extensionMeta.version, extensionReady, extensionRun?.status]);

  useEffect(() => {
    const outdated = extensionReady && extensionNeedsUpdate(extensionMeta.version, extensionMeta.buildId);
    if (!outdated || extensionRun?.status === "running" || extensionReloadRequestedRef.current) return;

    extensionReloadRequestedRef.current = true;
    setAssistantMessage("正在接入新版后台采集能力，完成后会自动续跑。");
    requestExtension({ type: "AIHR_WEB_RELOAD_EXTENSION" }, 5000)
      .catch(() => undefined)
      .finally(() => window.setTimeout(() => window.location.reload(), 1200));
  }, [extensionMeta.buildId, extensionMeta.version, extensionReady, extensionRun?.status]);

  function tryAcquireAutoPilotLock() {
    const now = Date.now();
    try {
      const rawLock = window.localStorage.getItem(autoPilotLockKey);
      const lock = rawLock ? (JSON.parse(rawLock) as { owner?: string; expiresAt?: number }) : null;
      if (lock?.expiresAt && lock.expiresAt > now && lock.owner !== tabInstanceIdRef.current) {
        return false;
      }
      window.localStorage.setItem(
        autoPilotLockKey,
        JSON.stringify({ owner: tabInstanceIdRef.current, expiresAt: now + autoPilotLockTtlMs })
      );
      return true;
    } catch {
      return true;
    }
  }

  function requestExtension<T>(message: Record<string, unknown>, timeoutMs = 5000): Promise<T> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        const messageText =
          "没有收到扩展响应。下一步：打开 chrome://extensions，确认 AI History Recall Capture 已启用；如果刚安装或更新过扩展，点 Reload 后回到本页。";
        setExtensionReady(false);
        setExtensionBridgeError(messageText);
        setExtensionCheckedAt(new Date().toISOString());
        reject(new Error(messageText));
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.data?.source !== "aihr-extension") return;
        if (event.data.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (event.data.ok === false) {
          setExtensionBridgeError(event.data.error || "扩展执行失败");
          setExtensionCheckedAt(new Date().toISOString());
          reject(new Error(event.data.error || "扩展执行失败"));
          return;
        }
        setExtensionReady(true);
        setExtensionMeta({ version: event.data.version, buildId: event.data.buildId });
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
        resolve(event.data as T);
      };

      window.addEventListener("message", onMessage);
      window.postMessage({ source: "aihr-web", requestId, ...message }, window.location.origin);
    });
  }

  async function checkChrome() {
    setState("chrome");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/chrome");
      const data = await response.json();
      setChromeStatus(data.status ?? null);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "检查 Chrome CDP 失败");
    } finally {
      setState("idle");
    }
  }

  async function launchChrome() {
    setState("chrome");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/chrome", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({})
      });
      const data = await response.json();
      setChromeStatus(data.status ?? null);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "启动 Chrome CDP 失败");
    } finally {
      setState("idle");
    }
  }

  async function openPlatforms() {
    setState("chrome");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/chrome/open", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ platforms: ["chatgpt", "gemini", "deepseek", "qwen"] })
      });
      const data = await response.json();
      setChromeStatus(data.status ?? null);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "打开平台页面失败");
    } finally {
      setState("idle");
    }
  }

  async function preflightPlatforms() {
    setState("chrome");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/chrome/preflight", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ platforms: ["chatgpt", "gemini", "deepseek", "qwen"] })
      });
      const data = await response.json();
      setChromeStatus(data.status ?? null);
      setPreflight((data.platforms ?? []) as PlatformPreflight[]);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "预检平台状态失败");
    } finally {
      setState("idle");
    }
  }

  async function prepareFullCapture() {
    setState("chrome");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/full", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({
          launchChrome: true,
          openPlatforms: true,
          preflight: true,
          createJob: false,
          platforms: ["chatgpt", "gemini", "deepseek", "qwen"]
        })
      });
      const data = await response.json();
      setChromeStatus(data.preflight?.status ?? data.launch?.status ?? null);
      setPreflight((data.preflight?.platforms ?? []) as PlatformPreflight[]);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "准备全量采集失败");
    } finally {
      setState("idle");
    }
  }

  async function refreshJobs() {
    const response = await apiFetch("/api/capture/jobs");
    const data = await response.json();
    const nextJobs = (data.jobs ?? []) as JobSummary[];
    setJobs(nextJobs);
    if (!selectedJobId && nextJobs[0]) {
      setSelectedJobId(nextJobs[0].id);
    }
  }

  async function refreshAudit() {
    setResult("");
    try {
      const response = await apiFetch("/api/capture/audit");
      const data = await response.json();
      setAudit((data.audit?.platforms ?? []) as PlatformAudit[]);
      setAuditSummary(data.audit ? (data.audit as CaptureAuditSummary) : null);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "刷新采集审计失败");
    }
  }

  async function loadCaptureAudit() {
    const response = await apiFetch("/api/capture/audit");
    const data = await response.json();
    const platforms = (data.audit?.platforms ?? []) as PlatformAudit[];
    const summary = data.audit ? (data.audit as CaptureAuditSummary) : null;
    setAudit(platforms);
    setAuditSummary(summary);
    return { data, platforms, summary };
  }

  async function createPlan() {
    setState("planning");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/plan", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction })
      });
      const data = await response.json();
      setPlan(JSON.stringify(data.plan ?? data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "生成计划失败");
    } finally {
      setState("idle");
    }
  }

  async function runCapture() {
    setState("capturing");
    setResult("");
    try {
      const parsedPlan = JSON.parse(plan);
      const response = await apiFetch("/api/capture/browser", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify(parsedPlan)
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "采集失败");
    } finally {
      setState("idle");
    }
  }

  async function discoverHistory() {
    setState("planning");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/discover", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({
          platform,
          maxItems,
          maxScrolls,
          stopAfterNoNewScrolls: maxItems >= 500 ? 8 : 4,
          exhaustive: maxItems >= 500
        })
      });
      const data = await response.json();
      setPlan(JSON.stringify(data.plan ?? data, null, 2));
      setResult(JSON.stringify(data.discovery ?? data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "发现历史列表失败");
    } finally {
      setState("idle");
    }
  }

  async function runAgent(dryRun = false) {
    setState("agent");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/agent", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction: agentInstruction, dryRun })
      });
      const data = await response.json();
      if (dryRun) {
        setPlan(JSON.stringify(data.plan ?? data, null, 2));
      }
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Agent 执行失败");
    } finally {
      setState("idle");
    }
  }

  async function createExtensionPlan() {
    setState("extension");
    setResult("");
    try {
      const response = await apiFetch("/api/extension/plan", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction: extensionInstruction })
      });
      const data = await response.json();
      setExtensionPlan(JSON.stringify(data.plan ?? data, null, 2));
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "生成扩展采集计划失败");
    } finally {
      setState("idle");
    }
  }

  async function createWeakEvidenceExtensionPlan() {
    const weakPlatforms = audit
      .filter(
        (item) =>
          item.importedConversations > 0 &&
          (item.latestDiscovery?.evidenceStrong !== true || (item.latestDiscovery?.failuresCount ?? 0) > 0)
      )
      .map((item) => item.platform);

    if (weakPlatforms.length === 0) {
      setResult("当前审计没有发现需要重跑的弱证据平台。");
      return;
    }

    setState("extension");
    setResult("");
    try {
      const instruction = `通过我当前已登录的 Chrome 扩展，低频重新发现并采集这些弱证据平台的全部历史对话：${weakPlatforms.join("、")}。`;
      setExtensionInstruction(instruction);
      const response = await apiFetch("/api/extension/plan", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction })
      });
      const data = await response.json();
      setExtensionPlan(JSON.stringify(data.plan ?? data, null, 2));
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "生成弱证据平台扩展计划失败");
    } finally {
      setState("idle");
    }
  }

  function weakEvidencePlatforms(platforms: PlatformAudit[]) {
    return platforms
      .filter(
        (item) =>
          item.importedConversations > 0 &&
          (item.latestDiscovery?.evidenceStrong !== true || (item.latestDiscovery?.failuresCount ?? 0) > 0)
      )
      .map((item) => item.platform);
  }

  function missingOrWeakPlatforms(platforms: PlatformAudit[]) {
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

  async function createPlanFromInstruction(instructionText: string) {
    const response = await apiFetch("/api/extension/plan", {
      method: "POST",
      headers: withApiToken({ "content-type": "application/json" }),
      body: JSON.stringify({ instruction: instructionText })
    });
    const data = await response.json();
    const nextPlan = data.plan ?? data;
    setExtensionInstruction(instructionText);
    setExtensionPlan(JSON.stringify(nextPlan, null, 2));
    return { data, plan: nextPlan };
  }

  async function runGuidedExtensionFlow() {
    setState("extension");
    setResult("");
    setAssistantSteps([]);
    const addStep = (step: string) => {
      setAssistantSteps((steps) => [...steps, step]);
    };
    try {
      setAssistantMessage("正在检查扩展连接和后台任务状态...");
      addStep("检查 Chrome 扩展是否已连接");
      const statusResponse = await requestExtension<{ run?: ExtensionRunStatus }>({
        type: "AIHR_WEB_GET_STATUS"
      });
      const run = statusResponse.run ?? null;
      setExtensionRun(run);

      if (run?.status === "running") {
        addStep("发现已有任务正在运行，进入观察模式");
        setAssistantMessage("扩展任务已经在运行中。我会自动显示进度，并在结束后更新本地审计。");
        setResult("");
        return;
      }

      if (run?.status === "stopped" && run.queue?.length && (run.nextIndex ?? 0) < run.queue.length) {
        addStep("发现可继续队列，自动继续");
        setAssistantMessage("检测到已停止但可继续的队列，正在自动继续...");
        const response = await requestExtension<{ result?: { run?: ExtensionRunStatus } }>({
          type: "AIHR_WEB_RESUME_CAPTURE"
        });
        setExtensionRun(response.result?.run ?? null);
        setResult("");
        setAssistantMessage("已继续上次队列。保持 Chrome 和本地应用运行即可。");
        return;
      }

      if (run?.status === "stopped" || run?.status === "failed") {
        addStep("清理不可继续的旧任务状态");
        setAssistantMessage("检测到旧任务状态不可继续，正在自动清理后重新规划...");
        await requestExtension({
          type: "AIHR_WEB_CLEAR_STATUS"
        });
        setExtensionRun(null);
      }

      setAssistantMessage("正在读取本地审计，判断需要采集哪些平台...");
      addStep("读取本地审计，判断哪些平台需要采集");
      const { platforms, summary } = await loadCaptureAudit();
      const weakPlatforms = weakEvidencePlatforms(platforms);
      const targetPlatforms = summary?.readyForReview ? [] : weakPlatforms.length > 0 ? weakPlatforms : missingOrWeakPlatforms(platforms);

      if (summary?.readyForReview) {
        addStep("审计已就绪，无需启动新采集");
        setAssistantMessage("本地审计已经就绪。无需继续采集；可以人工抽查平台历史列表后确认完成。");
        setResult("");
        return;
      }

      const instructionText =
        targetPlatforms.length > 0 && targetPlatforms.length < 4
          ? `通过我当前已登录的 Chrome 扩展，低频重新发现并采集这些平台的全部历史对话：${targetPlatforms.join("、")}。`
          : defaultExtensionInstruction;

      setAssistantMessage(`将自动生成并下发采集计划：${targetPlatforms.length ? targetPlatforms.join("、") : "四个平台"}。`);
      addStep(`生成采集计划：${targetPlatforms.length ? targetPlatforms.join("、") : "四个平台"}`);
      const { plan: nextPlan } = await createPlanFromInstruction(instructionText);
      addStep("下发计划给常驻 Chrome 扩展");
      const startResponse = await requestExtension<{ result?: { run?: ExtensionRunStatus } }>(
        {
          type: "AIHR_WEB_START_CAPTURE",
          plan: nextPlan
        },
        8000
      );
      setExtensionRun(startResponse.result?.run ?? null);
      setResult("");
      setAssistantMessage("采集任务已下发。它会在 Chrome 后台低频运行；页面会自动更新状态和审计结果。");
      addStep("任务已启动，等待扩展低频采集");
    } catch (error) {
      const message = error instanceof Error ? error.message : "一键采集向导失败";
      addStep(`遇到问题：${message}`);
      setAssistantMessage(message);
      setResult(message);
    } finally {
      setState("idle");
    }
  }

  async function startExtensionCapture() {
    setState("extension");
    setResult("");
    try {
      const parsedPlan = JSON.parse(extensionPlan);
      const response = await requestExtension<{ result?: { run?: ExtensionRunStatus } }>(
        {
          type: "AIHR_WEB_START_CAPTURE",
          plan: parsedPlan
        },
        8000
      );
      setExtensionReady(true);
      setExtensionRun(response.result?.run ?? null);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "启动扩展采集失败");
    } finally {
      setState("idle");
    }
  }

  async function refreshExtensionStatus() {
    setState("extension");
    setResult("");
    try {
      const response = await requestExtension<{ run?: ExtensionRunStatus }>({
        type: "AIHR_WEB_GET_STATUS"
      });
      setExtensionReady(true);
      setExtensionRun(response.run ?? null);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "读取扩展状态失败");
    } finally {
      setState("idle");
    }
  }

  async function copyExtensionPath() {
    try {
      await navigator.clipboard.writeText(extensionDirectoryPath);
      setAssistantMessage("扩展目录已复制。到 Chrome 扩展页选择 Load unpacked 时粘贴这个路径。");
    } catch {
      setAssistantMessage(`扩展目录：${extensionDirectoryPath}`);
    }
  }

  async function copyChromeExtensionsUrl() {
    try {
      await navigator.clipboard.writeText(chromeExtensionsUrl);
      setAssistantMessage("扩展管理页地址已复制。粘到 Chrome 地址栏打开即可。");
    } catch {
      setAssistantMessage(`Chrome 扩展管理页：${chromeExtensionsUrl}`);
    }
  }

  async function stopExtensionCapture() {
    setState("extension");
    setResult("");
    try {
      const response = await requestExtension({
        type: "AIHR_WEB_STOP_CAPTURE"
      });
      setResult(JSON.stringify(response, null, 2));
      await refreshExtensionStatus();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "停止扩展采集失败");
    } finally {
      setState("idle");
    }
  }

  async function resumeExtensionCapture() {
    setState("extension");
    setResult("");
    try {
      const response = await requestExtension<{ result?: { run?: ExtensionRunStatus } }>({
        type: "AIHR_WEB_RESUME_CAPTURE"
      });
      setExtensionReady(true);
      setExtensionRun(response.result?.run ?? null);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "继续扩展队列失败");
    } finally {
      setState("idle");
    }
  }

  async function clearExtensionStatus() {
    setState("extension");
    setResult("");
    try {
      const response = await requestExtension({
        type: "AIHR_WEB_CLEAR_STATUS"
      });
      setExtensionReady(true);
      setExtensionRun(null);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "清理扩展状态失败");
    } finally {
      setState("idle");
    }
  }

  async function createJob() {
    setState("planning");
    setResult("");
    try {
      const response = await apiFetch("/api/capture/jobs", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ instruction: jobInstruction })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      if (data.job?.id) {
        setSelectedJobId(data.job.id);
      }
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "创建采集任务失败");
    } finally {
      setState("idle");
    }
  }

  async function runJobBatch() {
    if (!selectedJobId) {
      return;
    }

    setState("capturing");
    setResult("");
    try {
      const response = await apiFetch(`/api/capture/jobs/${selectedJobId}`, {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ batchSize, maxAttempts })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "执行任务批次失败");
    } finally {
      setState("idle");
    }
  }

  async function runJobUntilIdle() {
    if (!selectedJobId) {
      return;
    }

    setState("runningAll");
    setResult("");
    try {
      const response = await apiFetch(`/api/capture/jobs/${selectedJobId}`, {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({
          batchSize,
          maxAttempts,
          maxBatches,
          batchDelayMs: batchDelaySeconds * 1000,
          runUntilIdle: true
        })
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
      await refreshJobs();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "连续执行任务失败");
    } finally {
      setState("idle");
    }
  }

  function guidedButtonLabel() {
    if (state === "extension") return "处理中";
    if (!extensionReady) return "检查并连接扩展";
    if (extensionRun?.status === "running") return "查看后台采集进度";
    if (extensionRun?.status === "stopped") return "继续后台队列";
    if (auditSummary?.readyForReview) return "重新检查状态";
    if (weakEvidencePlatforms(audit).length > 0) return "重跑弱证据平台";
    return "一键诊断并继续采集";
  }

  function topStatusLabel() {
    if (!extensionReady) return "等待扩展";
    if (isExtensionOutdated() && extensionRun?.status === "running") return "旧扩展运行中";
    if (isExtensionOutdated()) return "扩展待更新";
    if (extensionRun?.status === "running") return "后台采集中";
    if (extensionRun?.status === "completed") return "采集完成";
    if (extensionRun?.status === "stopped") return "队列已暂停";
    if (extensionRun?.status === "failed") return "需要处理";
    if (auditSummary?.readyForReview) return "本地可用";
    return "已连接";
  }

  function isExtensionOutdated() {
    return extensionReady && extensionNeedsUpdate(extensionMeta.version, extensionMeta.buildId);
  }

  function runProgressPercent() {
    if (!extensionRun?.totalTargets) return 0;
    return Math.min(100, Math.round(((extensionRun.processed ?? 0) / extensionRun.totalTargets) * 100));
  }

  function currentCaptureLine() {
    if (extensionRun?.currentTarget?.platform) {
      const title = extensionRun.currentTarget.title ? `，${extensionRun.currentTarget.title}` : "";
      return `正在抓取 ${extensionRun.currentTarget.platform}${title}`;
    }

    if (extensionRun?.discoveryProgress?.platform && extensionRun.phase !== "capturing") {
      const progress = extensionRun.discoveryProgress;
      return `正在发现 ${progress.platform}，已识别 ${progress.targetsFound ?? 0} 条，扫描 ${progress.scannedTitles ?? 0} 条 · ${progress.phase ?? "discovering"}`;
    }

    return null;
  }

  function queuePlatformText() {
    const counts = extensionRun?.queuePlatformCounts;
    if (!counts) return null;
    return (["chatgpt", "gemini", "deepseek", "qwen"] as Platform[])
      .filter((platform) => counts[platform])
      .map((platform) => `${platform} ${counts[platform]}`)
      .join(" · ");
  }

  runGuidedExtensionFlowRef.current = () => {
    void runGuidedExtensionFlow();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="mt-2 font-mono text-xs">
            {extensionDirectoryPath}
          </div>
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
            <div className="mt-2 text-xs opacity-75">
              checked {new Date(extensionCheckedAt).toLocaleString()}
            </div>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <textarea
            value={extensionPlan}
            onChange={(event) => setExtensionPlan(event.target.value)}
            placeholder="生成后的 ExtensionCapturePlan JSON"
            className="min-h-44 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
          />
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
            onClick={() => refreshJobs()}
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
              <div
                key={item.platform}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm"
              >
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
                  pending {item.targetCounts.pending + item.targetCounts.running} · failed{" "}
                  {item.targetCounts.failed}
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

      {result ? (
        <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 lg:col-span-2">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">执行结果</summary>
          <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-[var(--surface-subtle)] p-4 text-xs leading-5">
            {result}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
