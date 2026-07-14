import type { CapturePlatform } from "@/capture/types";
import {
  launchChromeCdp,
  openChromePlatformPages,
  preflightChromePlatformPages,
  type ChromePlatformPreflightResult,
  type LaunchChromeCdpResult,
  type OpenChromePlatformPagesResult
} from "@/services/chrome-cdp-service";
import {
  createCaptureJob,
  runCaptureJobUntilIdle,
  type CreateCaptureJobResult,
  type RunCaptureJobUntilIdleResult
} from "@/services/capture-job-service";

export interface FullCaptureOptions {
  instruction?: string;
  platforms?: CapturePlatform[];
  launchChrome?: boolean;
  openPlatforms?: boolean;
  preflight?: boolean;
  createJob?: boolean;
  runUntilIdle?: boolean;
  batchSize?: number;
  maxBatches?: number;
  batchDelayMs?: number;
  maxAttempts?: number;
}

export interface FullCaptureResult {
  instruction: string;
  launch: LaunchChromeCdpResult | null;
  open: OpenChromePlatformPagesResult | null;
  preflight: ChromePlatformPreflightResult | null;
  job: CreateCaptureJobResult | null;
  run: RunCaptureJobUntilIdleResult | null;
  nextStep: string;
}

const defaultInstruction = "发现 ChatGPT、Gemini、DeepSeek、通义千问全部历史对话，创建可恢复采集任务。";

function normalizePlatforms(platforms: CapturePlatform[] | undefined): CapturePlatform[] {
  if (!platforms || platforms.length === 0) {
    return ["chatgpt", "gemini", "deepseek", "qwen"];
  }

  return platforms.filter(
    (platform): platform is CapturePlatform =>
      platform === "chatgpt" || platform === "gemini" || platform === "deepseek" || platform === "qwen"
  );
}

function nextStepFor(result: Omit<FullCaptureResult, "nextStep">) {
  if (result.preflight && !result.preflight.status.ok) {
    return "Chrome CDP 尚不可用。先启动本地 Chrome，再打开四个平台。";
  }

  if (result.preflight?.platforms.some((platform) => !platform.open)) {
    return "至少一个平台页面未打开。先打开四个平台并完成登录。";
  }

  if (result.preflight?.platforms.some((platform) => platform.likelyLoggedIn === false)) {
    return "至少一个平台看起来停在登录或鉴权页面。先完成登录，再创建采集任务。";
  }

  if (!result.job) {
    return "平台预检完成后，可以创建可恢复采集任务。";
  }

  if (!result.run) {
    return "采集任务已创建，可以按批次低频执行。";
  }

  return "全量采集向导已执行到当前请求允许的最后一步。";
}

export async function runFullCaptureWorkflow(options: FullCaptureOptions = {}): Promise<FullCaptureResult> {
  const platforms = normalizePlatforms(options.platforms);
  const instruction = options.instruction?.trim() || defaultInstruction;
  const launch = options.launchChrome ? await launchChromeCdp() : null;
  const open = options.openPlatforms ? await openChromePlatformPages(platforms) : null;
  const preflight = options.preflight !== false ? await preflightChromePlatformPages(platforms) : null;

  const canCreateJob =
    options.createJob === true &&
    (!preflight ||
      (preflight.status.ok &&
        preflight.platforms.every((platform) => platform.open && platform.likelyLoggedIn !== false)));

  const job = canCreateJob ? await createCaptureJob(instruction) : null;
  const run =
    options.runUntilIdle === true && job
      ? await runCaptureJobUntilIdle(job.job.id, {
          batchSize: options.batchSize,
          maxBatches: options.maxBatches,
          batchDelayMs: options.batchDelayMs,
          maxAttempts: options.maxAttempts
        })
      : null;

  const partial = {
    instruction,
    launch,
    open,
    preflight,
    job,
    run
  };

  return {
    ...partial,
    nextStep: nextStepFor(partial)
  };
}
