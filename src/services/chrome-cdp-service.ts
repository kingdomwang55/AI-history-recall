import { capturePlatformConfigs } from "@/capture/platforms";
import type { CapturePlatform } from "@/capture/types";

export interface ChromeCdpStatus {
  ok: boolean;
  endpoint: string;
  webSocketDebuggerUrl: string | null;
  browser: string | null;
  error: string | null;
}

export interface LaunchChromeCdpOptions {
  port?: number;
  userDataDir?: string;
  chromePath?: string;
}

export interface LaunchChromeCdpResult {
  launched: boolean;
  pid: number | null;
  command: string;
  args: string[];
  status: ChromeCdpStatus;
}

export interface OpenChromePlatformPagesResult {
  status: ChromeCdpStatus;
  opened: Array<{
    platform: CapturePlatform;
    url: string;
    devtoolsId: string | null;
  }>;
  failures: Array<{
    platform: CapturePlatform;
    url: string;
    error: string;
  }>;
}

export interface ChromePlatformPreflightResult {
  status: ChromeCdpStatus;
  platforms: Array<{
    platform: CapturePlatform;
    expectedUrl: string;
    open: boolean;
    url: string | null;
    title: string | null;
    textSample?: string | null;
    likelyLoggedIn: boolean | null;
    hint: string;
  }>;
}

const defaultPort = 9222;

type ProbePage = {
  url: () => string;
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
};

type ProbeContext = {
  pages: () => ProbePage[];
};

function endpointForPort(port: number) {
  return `http://127.0.0.1:${port}`;
}

function defaultChromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return "google-chrome";
}

function defaultUserDataDir() {
  return `${process.env.HOME || "."}/.ai-history-recall-chrome`;
}

async function fetchJson<T>(url: string, timeoutMs = 2500, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getChromeCdpStatus(port = defaultPort): Promise<ChromeCdpStatus> {
  const endpoint = process.env.CHROME_CDP_URL || endpointForPort(port);

  try {
    const version = await fetchJson<{
      Browser?: string;
      webSocketDebuggerUrl?: string;
    }>(`${endpoint.replace(/\/$/, "")}/json/version`);

    return {
      ok: Boolean(version.webSocketDebuggerUrl),
      endpoint,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl ?? null,
      browser: version.Browser ?? null,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      webSocketDebuggerUrl: null,
      browser: null,
      error: error instanceof Error ? error.message : "Chrome CDP 不可用"
    };
  }
}

export async function launchChromeCdp(
  options: LaunchChromeCdpOptions = {}
): Promise<LaunchChromeCdpResult> {
  const port = options.port ?? defaultPort;
  const statusBefore = await getChromeCdpStatus(port);
  const command = options.chromePath || defaultChromePath();
  const userDataDir = options.userDataDir || defaultUserDataDir();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];

  if (statusBefore.ok) {
    return {
      launched: false,
      pid: null,
      command,
      args,
      status: statusBefore
    };
  }

  const { spawn } = await import("node:child_process");
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  let status = await getChromeCdpStatus(port);
  for (let attempt = 0; attempt < 10 && !status.ok; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    status = await getChromeCdpStatus(port);
  }

  return {
    launched: true,
    pid: child.pid ?? null,
    command,
    args,
    status
  };
}

function normalizePlatforms(platforms: unknown): CapturePlatform[] {
  const requested = Array.isArray(platforms)
    ? platforms
    : ["chatgpt", "gemini", "deepseek", "qwen"];

  return requested.filter(
    (platform): platform is CapturePlatform =>
      platform === "chatgpt" || platform === "gemini" || platform === "deepseek" || platform === "qwen"
  );
}

export async function openChromePlatformPages(platforms?: unknown): Promise<OpenChromePlatformPagesResult> {
  const status = await getChromeCdpStatus();
  const opened: OpenChromePlatformPagesResult["opened"] = [];
  const failures: OpenChromePlatformPagesResult["failures"] = [];

  if (!status.ok) {
    return {
      status,
      opened,
      failures: normalizePlatforms(platforms).map((platform) => ({
        platform,
        url: capturePlatformConfigs[platform].historyUrl,
        error: status.error ?? "Chrome CDP 不可用"
      }))
    };
  }

  const endpoint = status.endpoint.replace(/\/$/, "");

  for (const platform of normalizePlatforms(platforms)) {
    const url = capturePlatformConfigs[platform].historyUrl;
    try {
      const tab = await fetchJson<{ id?: string }>(
        `${endpoint}/json/new?${encodeURIComponent(url)}`,
        5000,
        { method: "PUT" }
      );
      opened.push({
        platform,
        url,
        devtoolsId: tab.id ?? null
      });
    } catch (error) {
      failures.push({
        platform,
        url,
        error: error instanceof Error ? error.message : "打开平台页面失败"
      });
    }
  }

  return {
    status,
    opened,
    failures
  };
}

function isPlatformPage(platform: CapturePlatform, url: string) {
  try {
    const host = new URL(url).hostname;
    return capturePlatformConfigs[platform].hosts.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`)
    );
  } catch {
    return false;
  }
}

function inferLikelyLoggedIn(platform: CapturePlatform, url: string, title: string) {
  const haystack = `${url}\n${title}`.toLowerCase();

  if (/login|signin|sign-in|sign_in|auth|account|登录|登陆|验证码/.test(haystack)) {
    return false;
  }

  if (platform === "chatgpt" && /chatgpt|openai/.test(haystack)) {
    return true;
  }

  if (platform === "gemini" && /gemini/.test(haystack)) {
    return true;
  }

  if (platform === "deepseek" && /deepseek|深度求索/.test(haystack)) {
    return true;
  }

  if (platform === "qwen" && /qwen|通义|千问/.test(haystack)) {
    return true;
  }

  return null;
}

async function probePlatformText(platform: CapturePlatform) {
  try {
    const playwright = await import("playwright-core");
    const browser = await playwright.chromium.connectOverCDP(process.env.CHROME_CDP_URL || endpointForPort(defaultPort));
    const disconnect = async () => {
      if (typeof browser.disconnect === "function") {
        await browser.disconnect();
      }
    };
    const pages = (browser.contexts() as ProbeContext[]).flatMap((context) => context.pages());
    const page = pages.find((candidate) => isPlatformPage(platform, candidate.url()));

    if (!page) {
      await disconnect().catch(() => undefined);
      return null;
    }

    const text = await page
      .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200))
      .catch(() => null);

    await disconnect().catch(() => undefined);

    return text;
  } catch {
    return null;
  }
}

function refineLikelyLoggedIn(platform: CapturePlatform, base: boolean | null, text: string | null) {
  if (!text) {
    return base;
  }

  const normalized = text.toLowerCase();

  if (/登录|登陆|sign in|sign-in|signin|sign_in|验证码|手机号|continue with|log in/.test(normalized)) {
    return false;
  }

  if (platform === "qwen" && /暂无对话/.test(text)) {
    return false;
  }

  return base;
}

export async function preflightChromePlatformPages(platforms?: unknown): Promise<ChromePlatformPreflightResult> {
  const status = await getChromeCdpStatus();
  const requested = normalizePlatforms(platforms);

  if (!status.ok) {
    return {
      status,
      platforms: requested.map((platform) => ({
        platform,
        expectedUrl: capturePlatformConfigs[platform].historyUrl,
        open: false,
        url: null,
        title: null,
        likelyLoggedIn: null,
        hint: "Chrome CDP 不可用，请先启动本地 Chrome。"
      }))
    };
  }

  const tabs = await fetchJson<Array<{ url?: string; title?: string }>>(
    `${status.endpoint.replace(/\/$/, "")}/json/list`,
    3500
  );

  const platformResults = [];

  for (const platform of requested) {
      const tab = tabs.find((candidate) => candidate.url && isPlatformPage(platform, candidate.url));
      const url = tab?.url ?? null;
      const title = tab?.title ?? null;
      const textSample = tab ? await probePlatformText(platform) : null;
      const likelyLoggedIn =
        url && title ? refineLikelyLoggedIn(platform, inferLikelyLoggedIn(platform, url, title), textSample) : null;

      platformResults.push({
        platform,
        expectedUrl: capturePlatformConfigs[platform].historyUrl,
        open: Boolean(tab),
        url,
        title,
        textSample,
        likelyLoggedIn,
        hint: !tab
          ? "未发现对应平台标签页，请先打开平台页面。"
          : likelyLoggedIn === false
            ? "页面看起来停在登录或鉴权流程，请先完成登录。"
            : "页面已打开，可以继续创建或执行采集任务。"
      });
  }

  return {
    status,
    platforms: platformResults
  };
}
