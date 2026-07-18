import type { ConversationAdapter } from "./base";
import { normalizeMessages, normalizeRole } from "./base";
import {
  asString,
  baseConversation,
  contentToText,
  conversationsFromRoot,
  dateToIso,
  fallbackTitle,
  isJsonInput,
  isObject,
  messagesFromList,
  parseJson
} from "./official-json";

function mappingMessages(mapping: unknown) {
  if (!isObject(mapping)) return [];

  return normalizeMessages(
    Object.values(mapping)
      .map((node) => {
        if (!isObject(node) || !isObject(node.message)) return null;
        const raw = node.message;
        const role = isObject(raw.author) ? raw.author.role : undefined;
        const content = contentToText(raw.content).trim();
        if (!content) return null;
        return {
          role: normalizeRole(role),
          content,
          createdAt: dateToIso(raw.create_time ?? raw.created_at)
        };
      })
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .sort((left, right) => {
        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : Number.NaN;
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : Number.NaN;
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
        return 0;
      })
  );
}

function parseConversation(raw: unknown, fallback: string) {
  if (!isObject(raw)) return null;
  const messages = mappingMessages(raw.mapping);
  const listMessages = messages.length > 0 ? messages : messagesFromList(raw.messages);
  if (listMessages.length === 0) return null;

  return baseConversation(
    {
      ...raw,
      id: raw.id ?? raw.conversation_id,
      title: asString(raw.title) ?? asString(raw.name)
    },
    "chatgpt",
    fallback,
    listMessages
  );
}

function looksLikeChatGptExport(value: unknown) {
  return conversationsFromRoot(value).some(
    (item) =>
      isObject(item) &&
      (isObject(item.mapping) ||
        asString(item.moderation_results) !== undefined ||
        asString(item.conversation_template_id) !== undefined)
  );
}

export const chatGptAdapter: ConversationAdapter = {
  id: "chatgpt",
  displayName: "ChatGPT Adapter",
  canHandle(input) {
    if (!isJsonInput(input)) return false;
    if (/conversations\.json$/i.test(input.fileName) || /chatgpt|openai/i.test(input.fileName)) {
      try {
        return looksLikeChatGptExport(parseJson(input));
      } catch {
        return false;
      }
    }
    return false;
  },
  async parse(input) {
    const parsed = parseJson(input);
    const fallback = fallbackTitle(input);
    return conversationsFromRoot(parsed)
      .map((item) => parseConversation(item, fallback))
      .filter((conversation): conversation is NonNullable<typeof conversation> => Boolean(conversation));
  }
};
