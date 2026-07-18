import type { ImportFileInput, ParsedConversation, ParsedMessage } from "@/types/conversation";
import { cleanTitle, fileBaseName, normalizeMessages, normalizeRole } from "./base";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonInput(input: ImportFileInput) {
  return input.fileName.toLowerCase().endsWith(".json") || input.mimeType === "application/json";
}

export function parseJson(input: ImportFileInput): unknown {
  return JSON.parse(input.content) as unknown;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function dateToIso(value: unknown): string | null {
  if (typeof value === "number") {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  return null;
}

export function contentToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map(contentToText).filter(Boolean).join("\n");
  }

  if (isObject(value)) {
    if (Array.isArray(value.parts)) return value.parts.map(contentToText).filter(Boolean).join("\n");
    if (Array.isArray(value.content)) return value.content.map(contentToText).filter(Boolean).join("\n");

    for (const key of ["text", "content", "markdown", "value", "body", "message"]) {
      const nested = contentToText(value[key]);
      if (nested) return nested;
    }
  }

  return "";
}

export function directMessage(raw: unknown): ParsedMessage | null {
  if (!isObject(raw)) {
    const content = contentToText(raw).trim();
    return content ? { role: "unknown", content } : null;
  }

  const roleSource = isObject(raw.author) ? raw.author.role : raw.role ?? raw.sender ?? raw.from ?? raw.author;
  const content = contentToText(
    raw.content ?? raw.text ?? raw.markdown ?? raw.message ?? raw.body ?? raw.answer ?? raw.prompt
  ).trim();

  if (!content) return null;

  return {
    role: normalizeRole(roleSource),
    content,
    createdAt: dateToIso(raw.created_at ?? raw.createdAt ?? raw.create_time ?? raw.timestamp)
  };
}

export function messagesFromList(value: unknown): ParsedMessage[] {
  if (!Array.isArray(value)) return [];
  return normalizeMessages(value.map(directMessage).filter((message): message is ParsedMessage => Boolean(message)));
}

export function conversationsFromRoot(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];

  for (const key of ["conversations", "items", "data", "chats", "histories"]) {
    if (Array.isArray(value[key])) return value[key];
  }

  return [value];
}

export function sourceUrl(platform: string, id: unknown, explicitUrl?: unknown) {
  const url = asString(explicitUrl);
  if (url) return url;
  const conversationId = asString(id)?.trim();
  if (!conversationId) return undefined;
  if (platform === "chatgpt") return `https://chatgpt.com/c/${conversationId}`;
  if (platform === "claude") return `https://claude.ai/chat/${conversationId}`;
  if (platform === "deepseek") return `https://chat.deepseek.com/a/chat/s/${conversationId}`;
  if (platform === "qwen") return `https://www.qianwen.com/chat/${conversationId}`;
  return undefined;
}

export function baseConversation(
  raw: JsonObject,
  platform: string,
  fallbackTitle: string,
  messages: ParsedMessage[]
): ParsedConversation {
  return {
    sourcePlatform: platform,
    title: cleanTitle(asString(raw.title ?? raw.name ?? raw.conversation_title ?? raw.topic), fallbackTitle),
    createdAt: dateToIso(raw.created_at ?? raw.createdAt ?? raw.create_time ?? raw.inserted_at),
    updatedAt: dateToIso(raw.updated_at ?? raw.updatedAt ?? raw.update_time ?? raw.last_message_at),
    sourceUrl: sourceUrl(
      platform,
      raw.id ?? raw.uuid ?? raw.conversation_id ?? raw.conversationId ?? raw.chat_id ?? raw.chatId,
      raw.url ?? raw.source_url ?? raw.sourceUrl
    ),
    messages
  };
}

export function fallbackTitle(input: ImportFileInput) {
  return fileBaseName(input.fileName);
}
