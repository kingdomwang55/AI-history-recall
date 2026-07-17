import type { GeneratedInsight } from "@/services/knowledge-rule-service";
import type { ConversationWithMessages } from "@/types/conversation";

export interface KnowledgeModelStatus {
  requested: boolean;
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
}

function modelConfig() {
  const requested = process.env.AIHR_KNOWLEDGE_MODEL_ENABLED?.trim().toLocaleLowerCase() === "true";
  const baseUrl = process.env.LLM_BASE_URL?.trim() ?? "";
  const model = process.env.LLM_MODEL?.trim() ?? "";
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  const timeoutMs = Math.min(
    60_000,
    Math.max(2_000, Number.parseInt(process.env.AIHR_KNOWLEDGE_MODEL_TIMEOUT_MS || "30000", 10) || 30_000)
  );
  return { requested, baseUrl, model, apiKey, timeoutMs };
}

function safeModelUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function getKnowledgeModelStatus(): KnowledgeModelStatus {
  const config = modelConfig();
  const validUrl = safeModelUrl(config.baseUrl);
  return {
    requested: config.requested,
    enabled: config.requested && Boolean(validUrl) && Boolean(config.model),
    model: config.model || null,
    baseUrl: validUrl ? validUrl.href.replace(/\/$/, "") : null,
    hasApiKey: Boolean(config.apiKey)
  };
}

function completionUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function boundedConversation(conversation: ConversationWithMessages) {
  let remaining = 12_000;
  const messages = [...conversation.messages]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .flatMap((message) => {
      if (remaining <= 0) return [];
      const content = message.content
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .slice(0, Math.min(2400, remaining));
      remaining -= content.length;
      return [{ role: message.role, content }];
    });
  return { title: conversation.title.slice(0, 300), sourcePlatform: conversation.sourcePlatform, messages };
}

function parseJsonContent(value: string) {
  const source = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(source) as unknown;
}

function cleanGeneratedText(value: string) {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .trim();
}

function validatedModelInsight(value: unknown, fallback: GeneratedInsight, model: string): GeneratedInsight {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as { summary?: unknown; keyPoints?: unknown; tags?: unknown };
  const cleanSummary = typeof raw.summary === "string" ? cleanGeneratedText(raw.summary) : "";
  const summary = cleanSummary && cleanSummary.length <= 220
    ? cleanSummary
    : null;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints
        .filter((item): item is string => typeof item === "string")
        .map(cleanGeneratedText)
        .filter((item) => item.length > 0 && item.length <= 120)
        .slice(0, 5)
    : null;
  const tags = Array.isArray(raw.tags)
    ? [...new Set(
        raw.tags
          .filter((item): item is string => typeof item === "string")
          .map(cleanGeneratedText)
          .filter((item) => item.length > 0 && item.length <= 32)
      )].slice(0, 8)
    : null;
  const enhanced = Boolean(summary || (keyPoints && keyPoints.length) || (tags && tags.length));
  if (!enhanced) return fallback;
  return {
    summary: summary || fallback.summary,
    keyPoints: keyPoints?.length ? keyPoints : fallback.keyPoints,
    tags: tags?.length ? tags : fallback.tags,
    generator: "model",
    generatorVersion: `model:${model}`
  };
}

export async function enhanceKnowledgeWithModel(
  conversation: ConversationWithMessages,
  fallback: GeneratedInsight,
  fetchImpl: typeof fetch = fetch
): Promise<GeneratedInsight> {
  const config = modelConfig();
  const status = getKnowledgeModelStatus();
  if (!status.enabled) return fallback;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetchImpl(completionUrl(config.baseUrl), {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(config.timeoutMs),
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return strict JSON only with summary, keyPoints, and tags. Summary <= 220 characters, keyPoints <= 5 items of <= 120 characters, tags <= 8 items of <= 32 characters. Do not include secrets."
        },
        { role: "user", content: JSON.stringify(boundedConversation(conversation)) }
      ]
    })
  });
  if (!response.ok) throw new Error(`Knowledge model failed: ${response.status}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Knowledge model returned no content.");
  return validatedModelInsight(parseJsonContent(content), fallback, config.model);
}
