import { inferPlatformFromUrl } from "./platforms";
import type { CapturePlan, CapturePlatform, CaptureTarget } from "./types";

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

function extractUrls(text: string) {
  return text.match(/https?:\/\/[^\s"'<>，。]+/g) ?? [];
}

export function createRuleBasedCapturePlan(instruction: string): CapturePlan {
  const targets: CaptureTarget[] = [];

  for (const url of extractUrls(instruction)) {
    const platform = inferPlatformFromUrl(url);
    if (platform) {
      targets.push({ platform, url });
    }
  }

  return {
    targets: uniqueTargets(targets),
    rateLimit: {
      pageDelayMs: 4200,
      pageJitterMs: 2800,
      afterScrollDelayMs: 1400
    },
    importAfterCapture: true
  };
}

function isCapturePlatform(value: unknown): value is CapturePlatform {
  return value === "chatgpt" || value === "gemini" || value === "deepseek" || value === "qwen";
}

function sanitizePlan(value: unknown): CapturePlan {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { targets?: unknown }).targets)) {
    return { targets: [] };
  }

  const raw = value as {
    targets: Array<{ platform?: unknown; url?: unknown; title?: unknown }>;
    rateLimit?: CapturePlan["rateLimit"];
    importAfterCapture?: unknown;
  };

  const targets = raw.targets
    .map((target): CaptureTarget | null => {
      const platform = isCapturePlatform(target.platform)
        ? target.platform
        : typeof target.url === "string"
          ? inferPlatformFromUrl(target.url)
          : null;

      if (!platform || typeof target.url !== "string") {
        return null;
      }

      const sanitized: CaptureTarget = {
        platform,
        url: target.url
      };

      if (typeof target.title === "string") {
        sanitized.title = target.title;
      }

      return sanitized;
    })
    .filter((target): target is CaptureTarget => Boolean(target));

  return {
    targets: uniqueTargets(targets),
    rateLimit: raw.rateLimit,
    importAfterCapture: raw.importAfterCapture !== false
  };
}

export async function createLlmCapturePlan(instruction: string): Promise<CapturePlan> {
  const endpoint = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4.1-mini";

  if (!endpoint || !apiKey) {
    return createRuleBasedCapturePlan(instruction);
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
            "You turn a user request into a JSON capture plan for AI History Recall. Only output JSON with targets, rateLimit, importAfterCapture. Supported platforms: chatgpt, gemini, deepseek, qwen. Use only URLs explicitly supplied by the user."
        },
        {
          role: "user",
          content: instruction
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM planner failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return createRuleBasedCapturePlan(instruction);
  }

  return sanitizePlan(JSON.parse(content));
}
