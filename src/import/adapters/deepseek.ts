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

function deepSeekMessages(raw: Record<string, unknown>) {
  return messagesFromList(raw.messages ?? raw.chat_messages ?? raw.history ?? raw.records);
}

function parseConversation(raw: unknown, fallback: string) {
  if (!isObject(raw)) return null;
  const messages = deepSeekMessages(raw);
  if (messages.length === 0) return null;
  return baseConversation(
    {
      ...raw,
      id: raw.id ?? raw.conversation_id ?? raw.chat_session_id,
      title: asString(raw.title) ?? asString(raw.name) ?? asString(raw.topic)
    },
    "deepseek",
    fallback,
    messages
  );
}

function looksLikeDeepSeekExport(value: unknown) {
  return conversationsFromRoot(value).some(
    (item) =>
      isObject(item) &&
      (Array.isArray(item.messages) ||
        Array.isArray(item.history) ||
        asString(item.platform)?.toLowerCase() === "deepseek" ||
        asString(item.bot)?.toLowerCase().includes("deepseek"))
  );
}

export const deepSeekAdapter: ConversationAdapter = {
  id: "deepseek",
  displayName: "DeepSeek Adapter",
  canHandle(input) {
    if (!isJsonInput(input)) return false;
    if (!/deepseek|深度求索/i.test(input.fileName)) return false;
    try {
      return looksLikeDeepSeekExport(parseJson(input));
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
