import type { CapturePlatform } from "./types";

export type ExtensionCaptureMode = "all_platforms" | "platform";

export interface ExtensionCapturePlan {
  executor: "chrome_extension";
  mode: ExtensionCaptureMode;
  platforms: CapturePlatform[];
  maxItems: number;
  maxScrolls: number;
  delayMs: number;
  stopAfterNoNewScrolls: number;
  pageDelayMs: number;
  pageJitterMs: number;
  requiresLoggedInChrome: true;
  rationale: string;
}

function isCapturePlatform(value: unknown): value is CapturePlatform {
  return value === "chatgpt" || value === "gemini" || value === "deepseek" || value === "qwen";
}

function asksForAllPlatforms(instruction: string) {
  return /(全部平台|所有平台|四个平台|多个平台|所有\s*AI|全部\s*AI|all platforms|every platform|across AI tools)/i.test(
    instruction
  );
}

function asksForExhaustiveHistory(instruction: string) {
  return /(全部|所有|完整|全量|all|entire|complete)/i.test(instruction);
}

function inferPlatforms(instruction: string): CapturePlatform[] {
  const platforms: CapturePlatform[] = [];

  if (/(chatgpt|openai)/i.test(instruction)) platforms.push("chatgpt");
  if (/(gemini|bard|google)/i.test(instruction)) platforms.push("gemini");
  if (/(deepseek|深度求索|深度搜索)/i.test(instruction)) platforms.push("deepseek");
  if (/(qwen|qianwen|通义|千问|阿里)/i.test(instruction)) platforms.push("qwen");
  if (asksForAllPlatforms(instruction)) platforms.push("chatgpt", "gemini", "deepseek", "qwen");

  return [...new Set(platforms)];
}

function extractLimit(instruction: string, fallback: number) {
  const match = instruction.match(/(?:最近|前|top|limit|最多|抓取|采集|导入)?\s*(\d{1,4})\s*(?:条|个|篇|items?)?/i);
  if (!match) return fallback;

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 3000);
}

export function createRuleBasedExtensionPlan(instruction: string): ExtensionCapturePlan {
  const requestedPlatforms = inferPlatforms(instruction);
  const platforms: CapturePlatform[] =
    requestedPlatforms.length > 0 ? requestedPlatforms : ["chatgpt", "gemini", "deepseek", "qwen"];
  const exhaustive = asksForExhaustiveHistory(instruction);
  const maxItems = extractLimit(instruction, exhaustive ? 1000 : 50);

  return {
    executor: "chrome_extension",
    mode: platforms.length > 1 ? "all_platforms" : "platform",
    platforms,
    maxItems,
    maxScrolls: Math.min(Math.max(Math.ceil(maxItems / 5), 8), exhaustive ? 200 : 60),
    delayMs: 3200,
    stopAfterNoNewScrolls: exhaustive ? 8 : 4,
    pageDelayMs: 5200,
    pageJitterMs: 3200,
    requiresLoggedInChrome: true,
    rationale:
      "Use the resident Chrome extension so capture runs inside the user's logged-in Chrome session instead of an isolated CDP profile."
  };
}

function sanitizeExtensionPlan(value: unknown, fallback: ExtensionCapturePlan): ExtensionCapturePlan {
  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Partial<ExtensionCapturePlan>;
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.filter(isCapturePlatform).slice(0, 4)
    : fallback.platforms;
  const safePlatforms = platforms.length > 0 ? [...new Set(platforms)] : fallback.platforms;

  return {
    executor: "chrome_extension",
    mode: raw.mode === "platform" && safePlatforms.length === 1 ? "platform" : "all_platforms",
    platforms: safePlatforms,
    maxItems:
      typeof raw.maxItems === "number" ? Math.min(Math.max(raw.maxItems, 1), 3000) : fallback.maxItems,
    maxScrolls:
      typeof raw.maxScrolls === "number" ? Math.min(Math.max(raw.maxScrolls, 1), 600) : fallback.maxScrolls,
    delayMs:
      typeof raw.delayMs === "number" ? Math.min(Math.max(raw.delayMs, 1200), 30000) : fallback.delayMs,
    stopAfterNoNewScrolls:
      typeof raw.stopAfterNoNewScrolls === "number"
        ? Math.min(Math.max(raw.stopAfterNoNewScrolls, 2), 30)
        : fallback.stopAfterNoNewScrolls,
    pageDelayMs:
      typeof raw.pageDelayMs === "number" ? Math.min(Math.max(raw.pageDelayMs, 3000), 120000) : fallback.pageDelayMs,
    pageJitterMs:
      typeof raw.pageJitterMs === "number"
        ? Math.min(Math.max(raw.pageJitterMs, 0), 120000)
        : fallback.pageJitterMs,
    requiresLoggedInChrome: true,
    rationale: typeof raw.rationale === "string" ? raw.rationale : fallback.rationale
  };
}

export async function createExtensionCapturePlan(instruction: string): Promise<ExtensionCapturePlan> {
  const fallback = createRuleBasedExtensionPlan(instruction);
  const endpoint = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4.1-mini";

  if (!endpoint || !apiKey) {
    return fallback;
  }

  const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Create a Chrome-extension capture plan for AI History Recall. Output JSON only. Schema: {executor:'chrome_extension', mode:'all_platforms'|'platform', platforms:['chatgpt'|'gemini'|'deepseek'|'qwen'], maxItems, maxScrolls, delayMs, stopAfterNoNewScrolls, pageDelayMs, pageJitterMs, rationale}. Prefer all_platforms when the user asks for all history across AI tools. Use conservative rate limits. The extension runs in the user's already logged-in Chrome."
        },
        { role: "user", content: instruction }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Extension planner failed: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return fallback;

  return sanitizeExtensionPlan(JSON.parse(content), fallback);
}
