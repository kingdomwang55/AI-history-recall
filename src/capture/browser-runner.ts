import { getCapturePlatformConfig } from "./platforms";
import type {
  BrowserCaptureResult,
  CaptureDiscoveryOptions,
  CaptureDiscoveryResult,
  CapturePlan,
  CaptureRateLimit,
  CaptureTarget,
  ExtractedMessage
} from "./types";
import { parseLoopbackHttpUrl } from "@/lib/api-security";
import type { MessageRole } from "@/types/conversation";

type BrowserLike = {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
  disconnect?: () => Promise<void>;
};

type PageLike = {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForLoadState: (state: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<unknown>;
  mouse: {
    wheel: (deltaX: number, deltaY: number) => Promise<unknown>;
    click: (x: number, y: number) => Promise<unknown>;
  };
  evaluate: <T>(script: string) => Promise<T>;
  title: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
};

type PlaywrightCore = {
  chromium: {
    connectOverCDP: (endpointURL: string) => Promise<BrowserLike>;
  };
};

const defaultEndpoint = "http://127.0.0.1:9222";

type RawHistoryLink = {
  title?: string;
  url?: string;
};

type RawQwenHistoryRow = {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(limit: number) {
  return Math.floor(Math.random() * Math.max(limit, 0));
}

function normalizeRole(role: string | undefined): MessageRole {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  return "unknown";
}

function mergeRateLimit(
  base: CaptureRateLimit,
  override: Partial<CaptureRateLimit> | undefined
): CaptureRateLimit {
  return {
    pageDelayMs: override?.pageDelayMs ?? base.pageDelayMs,
    pageJitterMs: override?.pageJitterMs ?? base.pageJitterMs,
    afterScrollDelayMs: override?.afterScrollDelayMs ?? base.afterScrollDelayMs
  };
}

async function loadPlaywright(): Promise<PlaywrightCore> {
  try {
    return (await import("playwright-core")) as PlaywrightCore;
  } catch {
    throw new Error(
      "缺少 playwright-core。请安装依赖后再使用浏览器采集：npm install"
    );
  }
}

async function connectBrowser() {
  const endpoint = parseLoopbackHttpUrl(process.env.CHROME_CDP_URL || defaultEndpoint, "CHROME_CDP_URL")
    .toString()
    .replace(/\/$/, "");
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.connectOverCDP(endpoint);

  return { browser, endpoint };
}

async function disconnectBrowser(browser: BrowserLike) {
  if (typeof browser.disconnect === "function") {
    await browser.disconnect();
    return;
  }

  await browser.close();
}

async function hydratePage(
  page: PageLike,
  target: CaptureTarget,
  rateLimit: CaptureRateLimit
) {
  const config = getCapturePlatformConfig(target.platform);

  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 25000 });
  } catch {
    // Some AI apps keep streams or long polling open. A fixed low-frequency wait is safer here.
  }

  await sleep(rateLimit.pageDelayMs + jitter(rateLimit.pageJitterMs));

  for (const step of config.hydrateScrolls) {
    await page.mouse.wheel(step.scrollX ?? 0, step.scrollY);
    await sleep(step.delayMs ?? rateLimit.afterScrollDelayMs);
  }
}

async function captureTarget(page: PageLike, target: CaptureTarget, planRateLimit?: Partial<CaptureRateLimit>) {
  const config = getCapturePlatformConfig(target.platform);
  const rateLimit = mergeRateLimit(config.rateLimit, planRateLimit);

  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await hydratePage(page, target, rateLimit);

  const extracted = await page.evaluate<ExtractedMessage[]>(config.extractor);
  const messages = extracted
    .map((message) => ({
      role: normalizeRole(message.role),
      content: message.content.trim(),
      createdAt: message.createdAt ?? null
    }))
    .filter((message) => message.content.length > 0);

  if (messages.length === 0) {
    throw new Error("页面已打开，但没有提取到有效消息");
  }

  const sourceUrl = page.url();
  const pageTitle = await page.title().catch(() => "");

  return {
    sourcePlatform: target.platform,
    title: target.title?.trim() || pageTitle || sourceUrl,
    sourceUrl,
    createdAt: null,
    updatedAt: null,
    tags: [...config.defaultTags, "browser-capture"],
    summary: `Captured by AI History Recall browser runner from ${sourceUrl}`,
    messages
  };
}

export async function runBrowserCapture(plan: CapturePlan): Promise<BrowserCaptureResult> {
  if (plan.targets.length === 0) {
    return { conversations: [], failures: [] };
  }

  const { browser } = await connectBrowser();
  const conversations: BrowserCaptureResult["conversations"] = [];
  const failures: BrowserCaptureResult["failures"] = [];

  try {
    for (const target of plan.targets) {
      const page = await browser.newPage();
      try {
        conversations.push(await captureTarget(page, target, plan.rateLimit));
      } catch (error) {
        failures.push({
          platform: target.platform,
          url: target.url,
          title: target.title,
          error: error instanceof Error ? error.message : "抓取失败"
        });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await disconnectBrowser(browser).catch(() => undefined);
  }

  return { conversations, failures };
}

function isPlatformUrl(platform: CaptureTarget["platform"], url: string) {
  if (platform === "chatgpt") {
    return /https:\/\/(chatgpt\.com|chat\.openai\.com)\/c\//.test(url);
  }

  if (platform === "gemini") {
    return /https:\/\/gemini\.google\.com\/app\/[a-zA-Z0-9_-]+/.test(url);
  }

  if (platform === "deepseek") {
    return /https:\/\/chat\.deepseek\.com\/a\/chat\/s\//.test(url);
  }

  return /https:\/\/(www\.)?qianwen\.com\/chat\//.test(url);
}

function uniqueTargets(targets: CaptureTarget[]) {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.platform}:${target.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function discoverLinkedHistoryTargets(
  page: PageLike,
  options: CaptureDiscoveryOptions,
  rateLimit: CaptureRateLimit
) {
  const config = getCapturePlatformConfig(options.platform);
  const targets: CaptureTarget[] = [];
  const scannedTitles: string[] = [];
  const seenUrls = new Set<string>();
  const maxItems = Math.min(Math.max(options.maxItems ?? 100, 1), 1000);
  const maxScrolls = Math.min(Math.max(options.maxScrolls ?? 8, 0), 200);
  const stopAfterNoNewScrolls = Math.min(
    Math.max(options.stopAfterNoNewScrolls ?? (options.exhaustive ? 8 : 4), 1),
    30
  );
  let noNewScrolls = 0;
  let scrollsPerformed = 0;
  let stopReason: CaptureDiscoveryResult["stopReason"] = "max_scrolls";

  await page.goto(options.startUrl || config.historyUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await sleep(rateLimit.pageDelayMs + jitter(rateLimit.pageJitterMs));

  for (let scrollIndex = 0; scrollIndex <= maxScrolls && targets.length < maxItems; scrollIndex += 1) {
    const beforeCount = targets.length;
    const rows = config.historyExtractor
      ? await page.evaluate<RawHistoryLink[]>(config.historyExtractor)
      : [];

    for (const row of rows) {
      if (!row.url || !isPlatformUrl(options.platform, row.url)) {
        continue;
      }

      if (seenUrls.has(row.url)) {
        continue;
      }

      seenUrls.add(row.url);
      scannedTitles.push(row.title || row.url);
      targets.push({
        platform: options.platform,
        url: row.url,
        title: row.title
      });

      if (targets.length >= maxItems) {
        break;
      }
    }

    scrollsPerformed = scrollIndex + 1;
    noNewScrolls = targets.length === beforeCount ? noNewScrolls + 1 : 0;
    if (targets.length >= maxItems) {
      stopReason = "max_items";
      break;
    }
    if (noNewScrolls >= stopAfterNoNewScrolls) {
      stopReason = "no_new_targets";
      break;
    }

    await page.mouse.wheel(0, 620);
    await sleep(rateLimit.afterScrollDelayMs + jitter(900));
  }

  return {
    targets: uniqueTargets(targets).slice(0, maxItems),
    scannedTitles: [...new Set(scannedTitles)],
    stopReason,
    scrollsPerformed,
    maxItemsReached: targets.length >= maxItems,
    maxScrollsReached: stopReason === "max_scrolls",
    exhaustive: options.exhaustive === true
  };
}

async function discoverQwenHistoryTargets(
  page: PageLike,
  options: CaptureDiscoveryOptions,
  rateLimit: CaptureRateLimit
) {
  const config = getCapturePlatformConfig("qwen");
  const targets: CaptureTarget[] = [];
  const failures: CaptureDiscoveryResult["failures"] = [];
  const scannedTitles: string[] = [];
  const seenTitles = new Set<string>();
  const maxItems = Math.min(Math.max(options.maxItems ?? 60, 1), 1000);
  const maxScrolls = Math.min(Math.max(options.maxScrolls ?? 12, 0), 200);
  const stopAfterNoNewScrolls = Math.min(
    Math.max(options.stopAfterNoNewScrolls ?? (options.exhaustive ? 8 : 4), 1),
    30
  );
  let noNewScrolls = 0;
  let scrollsPerformed = 0;
  let stopReason: CaptureDiscoveryResult["stopReason"] = "max_scrolls";

  await page.goto(options.startUrl || config.historyUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await sleep(rateLimit.pageDelayMs + jitter(rateLimit.pageJitterMs));

  for (let scrollIndex = 0; scrollIndex <= maxScrolls && targets.length < maxItems; scrollIndex += 1) {
    const beforeCount = targets.length;
    const rows = config.historyExtractor
      ? await page.evaluate<RawQwenHistoryRow[]>(config.historyExtractor)
      : [];

    for (const row of rows) {
      if (targets.length >= maxItems) {
        break;
      }

      if (seenTitles.has(row.title)) {
        continue;
      }

      seenTitles.add(row.title);
      scannedTitles.push(row.title);

      try {
        await page.mouse.click(row.x + Math.min(92, Math.floor(row.width / 2)), row.y + Math.floor(row.height / 2));
        await sleep(rateLimit.pageDelayMs + jitter(rateLimit.pageJitterMs));

        const url = page.url();
        if (!isPlatformUrl("qwen", url)) {
          throw new Error(`点击后没有进入 Qwen 对话详情：${url}`);
        }

        targets.push({
          platform: "qwen",
          url,
          title: row.title
        });
      } catch (error) {
        failures.push({
          platform: "qwen",
          title: row.title,
          error: error instanceof Error ? error.message : "Qwen 历史行发现失败"
        });
      }
    }

    scrollsPerformed = scrollIndex + 1;
    noNewScrolls = targets.length === beforeCount ? noNewScrolls + 1 : 0;
    if (targets.length >= maxItems) {
      stopReason = "max_items";
      break;
    }
    if (noNewScrolls >= stopAfterNoNewScrolls) {
      stopReason = "no_new_targets";
      break;
    }

    await page.mouse.wheel(0, 620);
    await sleep(rateLimit.afterScrollDelayMs + jitter(900));
  }

  return {
    targets: uniqueTargets(targets).slice(0, maxItems),
    failures,
    scannedTitles,
    stopReason,
    scrollsPerformed,
    maxItemsReached: targets.length >= maxItems,
    maxScrollsReached: stopReason === "max_scrolls",
    exhaustive: options.exhaustive === true
  };
}

export async function discoverBrowserHistoryTargets(
  options: CaptureDiscoveryOptions
): Promise<CaptureDiscoveryResult> {
  const config = getCapturePlatformConfig(options.platform);
  const rateLimit = mergeRateLimit(config.rateLimit, options.rateLimit);
  const { browser } = await connectBrowser();
  const page = await browser.newPage();

  try {
    if (options.platform === "qwen") {
      return await discoverQwenHistoryTargets(page, options, rateLimit);
    }

    const discovery = await discoverLinkedHistoryTargets(page, options, rateLimit);
    return {
      ...discovery,
      failures: []
    };
  } finally {
    await page.close().catch(() => undefined);
    await disconnectBrowser(browser).catch(() => undefined);
  }
}
