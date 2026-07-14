import { discoverBrowserHistoryTargets, runBrowserCapture } from "./browser-runner";
import { createRuleBasedCapturePlan } from "./llm-planner";
import type {
  BrowserCaptureResult,
  CaptureDiscoveryOptions,
  CaptureDiscoveryResult,
  CapturePlatform,
  CaptureRateLimit,
  CaptureTarget
} from "./types";
import { importParsedConversations } from "@/services/import-service";

export type CaptureAgentAction =
  | {
      type: "discover";
      platform: CapturePlatform;
      maxItems?: number;
      maxScrolls?: number;
      stopAfterNoNewScrolls?: number;
      exhaustive?: boolean;
      startUrl?: string;
      rateLimit?: Partial<CaptureRateLimit>;
    }
  | {
      type: "capture";
      targets: CaptureTarget[];
      rateLimit?: Partial<CaptureRateLimit>;
      importAfterCapture?: boolean;
    }
  | {
      type: "finish";
      reason?: string;
    };

export interface CaptureAgentPlan {
  actions: CaptureAgentAction[];
}

export interface CaptureAgentResult {
  plan: CaptureAgentPlan;
  discoveries: Array<CaptureDiscoveryResult & { platform: CapturePlatform }>;
  capture: BrowserCaptureResult;
  imported: ReturnType<typeof importParsedConversations> | null;
}

const defaultRateLimit: Partial<CaptureRateLimit> = {
  pageDelayMs: 4300,
  pageJitterMs: 2800,
  afterScrollDelayMs: 1600
};

function isCapturePlatform(value: unknown): value is CapturePlatform {
  return value === "chatgpt" || value === "gemini" || value === "deepseek" || value === "qwen";
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

function inferRequestedPlatforms(instruction: string): CapturePlatform[] {
  const normalized = instruction.toLowerCase();
  const platforms: CapturePlatform[] = [];

  if (/(chatgpt|openai)/i.test(instruction)) {
    platforms.push("chatgpt");
  }
  if (/(gemini|bard|google)/i.test(instruction)) {
    platforms.push("gemini");
  }
  if (/(deepseek|深度求索|深度搜索)/i.test(instruction)) {
    platforms.push("deepseek");
  }
  if (/(qwen|qianwen|通义|千问|阿里云)/i.test(instruction)) {
    platforms.push("qwen");
  }
  if (/(全部|所有|all|四个|多个)/i.test(normalized)) {
    platforms.push("chatgpt", "gemini", "deepseek", "qwen");
  }

  return [...new Set(platforms)];
}

function extractFirstNumber(instruction: string, fallback: number) {
  const match = instruction.match(/(?:最近|前|top|limit|最多|抓取|采集|导入)?\s*(\d{1,3})\s*(?:条|个|篇|items?)?/i);
  if (!match) {
    return fallback;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), 1000);
}

function asksForAll(instruction: string) {
  return /(全部|所有|all|完整|全量)/i.test(instruction);
}

export function createRuleBasedAgentPlan(instruction: string): CaptureAgentPlan {
  const directPlan = createRuleBasedCapturePlan(instruction);

  if (directPlan.targets.length > 0) {
    return {
      actions: [
        {
          type: "capture",
          targets: directPlan.targets,
          rateLimit: directPlan.rateLimit,
          importAfterCapture: true
        },
        { type: "finish", reason: "已根据显式 URL 生成抓取动作" }
      ]
    };
  }

  const platforms = inferRequestedPlatforms(instruction);
  const exhaustive = asksForAll(instruction);
  const maxItems = extractFirstNumber(instruction, exhaustive ? 1000 : 20);
  const maxScrolls = Math.min(Math.max(Math.ceil(maxItems / 8), 3), exhaustive ? 200 : 30);

  if (platforms.length === 0) {
    return {
      actions: [
        {
          type: "finish",
          reason: "没有识别到平台或 URL。请提到 ChatGPT、Gemini、DeepSeek、通义千问，或提供具体对话 URL。"
        }
      ]
    };
  }

  return {
    actions: [
      ...platforms.map((platform): CaptureAgentAction => ({
        type: "discover",
        platform,
        maxItems,
        maxScrolls,
        stopAfterNoNewScrolls: exhaustive ? 8 : 4,
        exhaustive,
        rateLimit: defaultRateLimit
      })),
      { type: "finish", reason: "发现到的目标会继续进入抓取和导入流程" }
    ]
  };
}

function sanitizeAction(value: unknown): CaptureAgentAction | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as {
    type?: unknown;
    platform?: unknown;
    maxItems?: unknown;
    maxScrolls?: unknown;
    stopAfterNoNewScrolls?: unknown;
    exhaustive?: unknown;
    startUrl?: unknown;
    targets?: unknown;
    rateLimit?: Partial<CaptureRateLimit>;
    importAfterCapture?: unknown;
    reason?: unknown;
  };

  if (raw.type === "discover" && isCapturePlatform(raw.platform)) {
    const action: CaptureAgentAction = {
      type: "discover",
      platform: raw.platform,
      maxItems: typeof raw.maxItems === "number" ? Math.min(Math.max(raw.maxItems, 1), 1000) : undefined,
      maxScrolls: typeof raw.maxScrolls === "number" ? Math.min(Math.max(raw.maxScrolls, 0), 200) : undefined,
      stopAfterNoNewScrolls:
        typeof raw.stopAfterNoNewScrolls === "number"
          ? Math.min(Math.max(raw.stopAfterNoNewScrolls, 1), 30)
          : undefined,
      exhaustive: raw.exhaustive === true,
      startUrl: typeof raw.startUrl === "string" ? raw.startUrl : undefined,
      rateLimit: raw.rateLimit
    };

    return action;
  }

  if (raw.type === "capture" && Array.isArray(raw.targets)) {
    const targets = raw.targets
      .map((target): CaptureTarget | null => {
        if (typeof target !== "object" || target === null) {
          return null;
        }

        const item = target as { platform?: unknown; url?: unknown; title?: unknown };
        if (!isCapturePlatform(item.platform) || typeof item.url !== "string" || !item.url.startsWith("http")) {
          return null;
        }

        return {
          platform: item.platform,
          url: item.url,
          title: typeof item.title === "string" ? item.title : undefined
        };
      })
      .filter((target): target is CaptureTarget => Boolean(target));

    return {
      type: "capture",
      targets: uniqueTargets(targets).slice(0, 200),
      rateLimit: raw.rateLimit,
      importAfterCapture: raw.importAfterCapture !== false
    };
  }

  if (raw.type === "finish") {
    return {
      type: "finish",
      reason: typeof raw.reason === "string" ? raw.reason : undefined
    };
  }

  return null;
}

function sanitizeAgentPlan(value: unknown): CaptureAgentPlan {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { actions?: unknown }).actions)) {
    return { actions: [] };
  }

  const actions = (value as { actions: unknown[] }).actions
    .map(sanitizeAction)
    .filter((action): action is CaptureAgentAction => Boolean(action))
    .slice(0, 8);

  return { actions };
}

export async function createLlmAgentPlan(instruction: string): Promise<CaptureAgentPlan> {
  const endpoint = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4.1-mini";

  if (!endpoint || !apiKey) {
    return createRuleBasedAgentPlan(instruction);
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
            "You create a safe browser capture agent plan for AI History Recall. Output JSON only: {\"actions\": [...]}. Supported actions: discover(platform,maxItems,maxScrolls,stopAfterNoNewScrolls,exhaustive,startUrl,rateLimit), capture(targets,rateLimit,importAfterCapture), finish(reason). Supported platforms: chatgpt, gemini, deepseek, qwen. If the user gives explicit URLs, use capture. If the user asks to collect all history without URLs, use discover with exhaustive=true, maxItems up to 1000, maxScrolls up to 200, and conservative rate limits. Never invent conversation URLs."
        },
        {
          role: "user",
          content: instruction
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM agent planner failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return createRuleBasedAgentPlan(instruction);
  }

  const plan = sanitizeAgentPlan(JSON.parse(content));
  return plan.actions.length > 0 ? plan : createRuleBasedAgentPlan(instruction);
}

function toDiscoveryOptions(action: Extract<CaptureAgentAction, { type: "discover" }>): CaptureDiscoveryOptions {
  return {
    platform: action.platform,
    maxItems: action.maxItems,
    maxScrolls: action.maxScrolls,
    stopAfterNoNewScrolls: action.stopAfterNoNewScrolls,
    exhaustive: action.exhaustive,
    startUrl: action.startUrl,
    rateLimit: action.rateLimit
  };
}

export async function runCaptureAgent(instruction: string): Promise<CaptureAgentResult> {
  const plan = await createLlmAgentPlan(instruction);
  const discoveries: CaptureAgentResult["discoveries"] = [];
  const discoveredTargets: CaptureTarget[] = [];
  const directTargets: CaptureTarget[] = [];
  let rateLimit: Partial<CaptureRateLimit> | undefined;
  let shouldImport = true;

  for (const action of plan.actions) {
    if (action.type === "discover") {
      const discovery = await discoverBrowserHistoryTargets(toDiscoveryOptions(action));
      discoveries.push({ ...discovery, platform: action.platform });
      discoveredTargets.push(...discovery.targets);
      rateLimit = action.rateLimit ?? rateLimit;
    }

    if (action.type === "capture") {
      directTargets.push(...action.targets);
      rateLimit = action.rateLimit ?? rateLimit;
      shouldImport = action.importAfterCapture !== false;
    }
  }

  const targets = uniqueTargets([...directTargets, ...discoveredTargets]).slice(0, 200);
  const capture =
    targets.length > 0
      ? await runBrowserCapture({
          targets,
          rateLimit: rateLimit ?? defaultRateLimit,
          importAfterCapture: shouldImport
        })
      : { conversations: [], failures: [] };

  const imported =
    shouldImport && capture.conversations.length > 0
      ? importParsedConversations(
          capture.conversations,
          `browser-agent-capture-${new Date().toISOString()}.json`,
          "browser_agent"
        )
      : null;

  return {
    plan,
    discoveries,
    capture,
    imported
  };
}
