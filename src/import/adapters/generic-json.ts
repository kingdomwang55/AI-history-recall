import type {
  ParsedConversation,
  ParsedMessage
} from "@/types/conversation";
import type { ConversationAdapter } from "./base";
import { cleanTitle, extensionOf, fileBaseName, normalizeRole } from "./base";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function dateToIso(value: unknown): string | null {
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

function contentToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(contentToText).filter(Boolean).join("\n");
  }

  if (isObject(value)) {
    if (Array.isArray(value.parts)) {
      return value.parts.map(contentToText).filter(Boolean).join("\n");
    }

    for (const key of ["text", "content", "markdown", "value", "body"]) {
      const nested = contentToText(value[key]);
      if (nested) {
        return nested;
      }
    }

    return JSON.stringify(value, null, 2);
  }

  return "";
}

function extractTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter((item): item is string => Boolean(item));
  }

  if (typeof value === "string") {
    return value
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function extractMessage(raw: unknown): ParsedMessage | null {
  if (!isObject(raw)) {
    const content = contentToText(raw).trim();
    return content ? { role: "unknown", content } : null;
  }

  const content = contentToText(
    raw.content ?? raw.text ?? raw.markdown ?? raw.message ?? raw.body
  ).trim();

  if (!content) {
    return null;
  }

  return {
    role: normalizeRole(raw.role ?? raw.author ?? raw.speaker ?? raw.from),
    content,
    createdAt: dateToIso(raw.created_at ?? raw.createdAt ?? raw.create_time)
  };
}

function extractChatGptMappingMessages(mapping: unknown): ParsedMessage[] {
  if (!isObject(mapping)) {
    return [];
  }

  return Object.values(mapping)
    .map((node) => {
      if (!isObject(node) || !isObject(node.message)) {
        return null;
      }

      const author = isObject(node.message.author)
        ? node.message.author.role
        : undefined;

      const message: ParsedMessage = {
        role: normalizeRole(author),
        content: contentToText(node.message.content).trim(),
        createdAt: dateToIso(node.message.create_time)
      };

      return message.content ? message : null;
    })
    .filter((message): message is ParsedMessage => Boolean(message));
}

function hasMessageList(value: unknown): value is JsonObject {
  return isObject(value) && Array.isArray(value.messages);
}

function parseConversation(raw: unknown, fallbackTitle: string): ParsedConversation {
  if (!isObject(raw)) {
    return {
      sourcePlatform: "generic_json",
      title: fallbackTitle,
      messages: []
    };
  }

  const mappingMessages = extractChatGptMappingMessages(raw.mapping);
  const listMessages = Array.isArray(raw.messages)
    ? raw.messages
        .map(extractMessage)
        .filter((message): message is ParsedMessage => Boolean(message))
    : [];

  const title = cleanTitle(
    asString(raw.title ?? raw.name ?? raw.conversation_title),
    fallbackTitle
  );

  return {
    sourcePlatform:
      asString(raw.source_platform ?? raw.sourcePlatform ?? raw.platform ?? raw.source) ??
      "generic_json",
    title,
    createdAt: dateToIso(raw.created_at ?? raw.createdAt ?? raw.create_time),
    updatedAt: dateToIso(raw.updated_at ?? raw.updatedAt ?? raw.update_time),
    tags: extractTags(raw.tags ?? raw.labels),
    summary: asString(raw.summary),
    sourceUrl: asString(raw.source_url ?? raw.sourceUrl ?? raw.url ?? raw.raw_url),
    messages: mappingMessages.length > 0 ? mappingMessages : listMessages
  };
}

function getConversationCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    if (value.every(hasMessageList)) {
      return value;
    }

    return [
      {
        messages: value
      }
    ];
  }

  if (isObject(value)) {
    for (const key of ["conversations", "items", "data"]) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }

    return [value];
  }

  return [];
}

export const genericJsonAdapter: ConversationAdapter = {
  id: "generic_json",
  displayName: "Generic JSON Adapter",
  canHandle(input) {
    return extensionOf(input.fileName) === "json" || input.mimeType === "application/json";
  },
  async parse(input) {
    const fallbackTitle = fileBaseName(input.fileName);
    const parsed = JSON.parse(input.content) as unknown;

    return getConversationCandidates(parsed)
      .map((candidate) => parseConversation(candidate, fallbackTitle))
      .filter((conversation) => conversation.messages.length > 0);
  }
};
