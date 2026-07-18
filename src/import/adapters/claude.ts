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

function claudeMessages(raw: Record<string, unknown>) {
  return messagesFromList(raw.chat_messages ?? raw.messages ?? raw.conversation);
}

function parseConversation(raw: unknown, fallback: string) {
  if (!isObject(raw)) return null;
  const messages = claudeMessages(raw);
  if (messages.length === 0) return null;
  return baseConversation(
    {
      ...raw,
      id: raw.uuid ?? raw.id,
      title: asString(raw.name) ?? asString(raw.title)
    },
    "claude",
    fallback,
    messages
  );
}

function looksLikeClaudeExport(value: unknown) {
  return conversationsFromRoot(value).some(
    (item) =>
      isObject(item) &&
      (Array.isArray(item.chat_messages) ||
        asString(item.uuid) !== undefined ||
        asString(item.account) === "claude")
  );
}

export const claudeAdapter: ConversationAdapter = {
  id: "claude",
  displayName: "Claude Adapter",
  canHandle(input) {
    if (!isJsonInput(input)) return false;
    if (!/claude|conversations/i.test(input.fileName)) return false;
    try {
      return looksLikeClaudeExport(parseJson(input));
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
