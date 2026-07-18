import type { ConversationAdapter } from "./base";
import {
  asString,
  baseConversation,
  conversationsFromRoot,
  fallbackTitle,
  isJsonInput,
  isObject,
  messagesFromList,
  parseJson
} from "./official-json";

function qwenMessages(raw: Record<string, unknown>) {
  return messagesFromList(raw.messages ?? raw.chat_messages ?? raw.history ?? raw.records ?? raw.contents);
}

function parseConversation(raw: unknown, fallback: string) {
  if (!isObject(raw)) return null;
  const messages = qwenMessages(raw);
  if (messages.length === 0) return null;
  return baseConversation(
    {
      ...raw,
      id: raw.id ?? raw.conversation_id ?? raw.chat_id ?? raw.session_id,
      title: asString(raw.title) ?? asString(raw.name) ?? asString(raw.topic)
    },
    "qwen",
    fallback,
    messages
  );
}

function looksLikeQwenExport(value: unknown) {
  return conversationsFromRoot(value).some(
    (item) =>
      isObject(item) &&
      (Array.isArray(item.messages) ||
        Array.isArray(item.history) ||
        asString(item.platform)?.toLowerCase() === "qwen" ||
        /qwen|通义|千问/i.test(String(item.source ?? item.model ?? "")))
  );
}

export const qwenAdapter: ConversationAdapter = {
  id: "qwen",
  displayName: "通义千问 Adapter",
  canHandle(input) {
    if (!isJsonInput(input)) return false;
    if (!/qwen|通义|千问/i.test(input.fileName)) return false;
    try {
      return looksLikeQwenExport(parseJson(input));
    } catch {
      return false;
    }
  },
  async parse(input) {
    const fallback = fallbackTitle(input);
    return conversationsFromRoot(parseJson(input))
      .map((item) => parseConversation(item, fallback))
      .filter((conversation): conversation is NonNullable<typeof conversation> => Boolean(conversation));
  }
};
