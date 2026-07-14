"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiState,
  ChromeStatus,
  ExtensionRunStatus,
  Platform,
  PlatformPreflight
} from "@/components/capture/capture-types";
import { apiFetch } from "@/components/capture/apiFetch";
import { CaptureAdvancedPanel } from "@/components/capture/CaptureAdvancedPanel";
import { CaptureGuidePanel } from "@/components/capture/CaptureGuidePanel";
import { useCaptureAudit } from "@/components/capture/useCaptureAudit";
import { useCaptureJobs } from "@/components/capture/useCaptureJobs";
import { extensionNeedsUpdate, useExtensionBridge } from "@/components/capture/useExtensionBridge";
import { withApiToken } from "@/lib/client-api";

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
const autoPilotLockKey = "aihr:capture:auto-pilot-lock";
const tabInstanceKey = "aihr:capture:tab-instance";
const autoPilotLockTtlMs = 120000;

function getTabInstanceId() {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem(tabInstanceKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(tabInstanceKey, id);
  return id;
}

export function CapturePlanner() {
  const autoPilotStartedRef = useRef(false);
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
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null);
  const [preflight, setPreflight] = useState<PlatformPreflight[]>([]);
  const [extensionInstruction, setExtensionInstruction] = useState(defaultExtensionInstruction);
  const [extensionPlan, setExtensionPlan] = useState("");
  const [assistantMessage, setAssistantMessage] = useState(
    "点击主按钮，系统会自动判断下一步，不需要记操作顺序。"
  );
  const [assistantSteps, setAssistantSteps] = useState<string[]>([]);
  const [autoPilotRetryTick, setAutoPilotRetryTick] = useState(0);
  const {
    audit,
    auditSummary,
    loadCaptureAudit,
    refreshAudit,
    weakEvidencePlatforms,
    missingOrWeakPlatforms
  } = useCaptureAudit({ setResult });
  const {
    jobInstruction,
    setJobInstruction,
    jobs,
    selectedJobId,
    setSelectedJobId,
    batchSize,
    setBatchSize,
    maxBatches,
    setMaxBatches,
    batchDelaySeconds,
    setBatchDelaySeconds,
    maxAttempts,
    setMaxAttempts,
    refreshJobs,
    createJob,
    runJobBatch,
    runJobUntilIdle
  } = useCaptureJobs({
    defaultJobInstruction,
    setState,
    setResult
  });

  const handleExtensionCompleted = useCallback(() => {
    autoPilotStartedRef.current = false;
    setAssistantMessage("后台采集已完成，正在自动更新审计结果。");
    void loadCaptureAudit();
  }, [loadCaptureAudit]);

  const handleExtensionFailed = useCallback(() => {
    autoPilotStartedRef.current = false;
    setAssistantMessage("后台采集失败，已自动读取状态；可以展开高级调试看错误详情。");
    void loadCaptureAudit();
  }, [loadCaptureAudit]);

  const handleExtensionStopped = useCallback(() => {
    setAssistantMessage("后台采集已停止。再次点击一键向导会自动继续可恢复队列或重新规划。");
    void loadCaptureAudit();
  }, [loadCaptureAudit]);

  const handleExtensionReloadRequested = useCallback(() => {
    setAssistantMessage("正在接入新版后台采集能力，完成后会自动续跑。");
  }, []);

  const {
    expectedExtensionVersion,
    extensionReady,
    extensionMeta,
    extensionCheckedAt,
    extensionBridgeError,
    extensionRun,
    setExtensionRun,
    requestExtension
  } = useExtensionBridge({
    onCompleted: handleExtensionCompleted,
    onFailed: handleExtensionFailed,
    onStopped: handleExtensionStopped,
    onReloadRequested: handleExtensionReloadRequested
  });

  const tryAcquireAutoPilotLock = useCallback(() => {
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
  }, []);

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
    state,
    tryAcquireAutoPilotLock
  ]);

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
      setExtensionRun(null);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "清理扩展状态失败");
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

  useEffect(() => {
    runGuidedExtensionFlowRef.current = () => {
      void runGuidedExtensionFlow();
    };
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <CaptureGuidePanel
        state={state}
        assistantMessage={assistantMessage}
        assistantSteps={assistantSteps}
        extensionReady={extensionReady}
        extensionMeta={extensionMeta}
        extensionRun={extensionRun}
        auditSummary={auditSummary}
        extensionDirectoryPath={extensionDirectoryPath}
        expectedExtensionVersion={expectedExtensionVersion}
        topStatusLabel={topStatusLabel}
        guidedButtonLabel={guidedButtonLabel}
        runProgressPercent={runProgressPercent}
        queuePlatformText={queuePlatformText}
        currentCaptureLine={currentCaptureLine}
        isExtensionOutdated={isExtensionOutdated}
        runGuidedExtensionFlow={runGuidedExtensionFlow}
        copyChromeExtensionsUrl={copyChromeExtensionsUrl}
        copyExtensionPath={copyExtensionPath}
      />

      <CaptureAdvancedPanel
        state={state}
        chromeStatus={chromeStatus}
        preflight={preflight}
        checkChrome={checkChrome}
        launchChrome={launchChrome}
        openPlatforms={openPlatforms}
        preflightPlatforms={preflightPlatforms}
        prepareFullCapture={prepareFullCapture}
        extensionInstruction={extensionInstruction}
        setExtensionInstruction={setExtensionInstruction}
        createExtensionPlan={createExtensionPlan}
        createWeakEvidenceExtensionPlan={createWeakEvidenceExtensionPlan}
        audit={audit}
        extensionPlan={extensionPlan}
        setExtensionPlan={setExtensionPlan}
        startExtensionCapture={startExtensionCapture}
        refreshExtensionStatus={refreshExtensionStatus}
        stopExtensionCapture={stopExtensionCapture}
        resumeExtensionCapture={resumeExtensionCapture}
        clearExtensionStatus={clearExtensionStatus}
        copyExtensionPath={copyExtensionPath}
        copyChromeExtensionsUrl={copyChromeExtensionsUrl}
        extensionReady={extensionReady}
        extensionBridgeError={extensionBridgeError}
        extensionMeta={extensionMeta}
        extensionCheckedAt={extensionCheckedAt}
        extensionDirectoryPath={extensionDirectoryPath}
        chromeExtensionsUrl={chromeExtensionsUrl}
        extensionRun={extensionRun}
        queuePlatformText={queuePlatformText}
        jobInstruction={jobInstruction}
        setJobInstruction={setJobInstruction}
        createJob={createJob}
        refreshJobs={refreshJobs}
        refreshAudit={refreshAudit}
        batchSize={batchSize}
        setBatchSize={setBatchSize}
        maxBatches={maxBatches}
        setMaxBatches={setMaxBatches}
        batchDelaySeconds={batchDelaySeconds}
        setBatchDelaySeconds={setBatchDelaySeconds}
        maxAttempts={maxAttempts}
        setMaxAttempts={setMaxAttempts}
        runJobBatch={runJobBatch}
        runJobUntilIdle={runJobUntilIdle}
        selectedJobId={selectedJobId}
        setSelectedJobId={setSelectedJobId}
        jobs={jobs}
        auditSummary={auditSummary}
        agentInstruction={agentInstruction}
        setAgentInstruction={setAgentInstruction}
        runAgent={runAgent}
        platform={platform}
        setPlatform={setPlatform}
        maxItems={maxItems}
        setMaxItems={setMaxItems}
        maxScrolls={maxScrolls}
        setMaxScrolls={setMaxScrolls}
        discoverHistory={discoverHistory}
        instruction={instruction}
        setInstruction={setInstruction}
        createPlan={createPlan}
        plan={plan}
        setPlan={setPlan}
        runCapture={runCapture}
      />
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
