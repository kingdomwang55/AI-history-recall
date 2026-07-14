import type {
  ImportFileInput,
  MessageRole,
  ParsedConversation,
  ParsedMessage
} from "@/types/conversation";

export interface ConversationAdapter {
  id: string;
  displayName: string;
  canHandle(input: ImportFileInput): boolean;
  parse(input: ImportFileInput): Promise<ParsedConversation[]>;
}

export function extensionOf(fileName: string) {
  const index = fileName.lastIndexOf(".");
  if (index === -1) {
    return "";
  }

  return fileName.slice(index + 1).toLowerCase();
}

export function fileBaseName(fileName: string) {
  const normalized = fileName.split(/[\\/]/).pop() ?? fileName;
  return normalized.replace(/\.[^.]+$/, "");
}

export function cleanTitle(title: string | undefined, fallback: string) {
  const value = (title ?? "").replace(/\s+/g, " ").trim();
  return value || fallback || "未命名对话";
}

export function normalizeRole(value: unknown): MessageRole {
  const role = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["user", "human", "q", "question", "用户", "问题", "问"].includes(role)) {
    return "user";
  }

  if (
    ["assistant", "ai", "bot", "model", "a", "answer", "助手", "回答", "答"].includes(
      role
    )
  ) {
    return "assistant";
  }

  if (["system", "系统"].includes(role)) {
    return "system";
  }

  return "unknown";
}

export function normalizeMessages(messages: ParsedMessage[]) {
  return messages
    .map((message) => ({
      ...message,
      content: message.content.replace(/\r\n/g, "\n").trim()
    }))
    .filter((message) => message.content.length > 0);
}
