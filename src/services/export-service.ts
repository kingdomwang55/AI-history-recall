import { getConversation } from "@/services/conversation-service";
import type { ConversationWithMessages, MessageRole } from "@/types/conversation";

export type ExportedConversationJson = ConversationWithMessages;

const roleHeadings: Record<MessageRole, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  unknown: "Unknown"
};

function requireConversation(id: string) {
  const conversation = getConversation(id);

  if (!conversation) {
    throw new Error("对话不存在");
  }

  return conversation;
}

function markdownEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

export function exportConversationJson(id: string): ExportedConversationJson {
  return requireConversation(id);
}

export function exportConversationMarkdown(id: string) {
  const conversation = requireConversation(id);
  const lines: string[] = [
    `# ${conversation.title}`,
    "",
    "## Metadata",
    "",
    `- Platform: ${conversation.sourcePlatform}`,
    `- Imported At: ${conversation.importedAt}`
  ];

  if (conversation.sourceUrl) {
    lines.push(`- Source URL: ${conversation.sourceUrl}`);
  }
  if (conversation.rawFileName) {
    lines.push(`- Raw File: ${conversation.rawFileName}`);
  }
  if (conversation.createdAt) {
    lines.push(`- Created At: ${conversation.createdAt}`);
  }
  if (conversation.updatedAt) {
    lines.push(`- Updated At: ${conversation.updatedAt}`);
  }
  if (conversation.tags.length > 0) {
    lines.push(`- Tags: ${conversation.tags.join(", ")}`);
  }
  if (conversation.summary) {
    lines.push("", "## Summary", "", conversation.summary);
  }
  if (conversation.note) {
    lines.push("", "## Note", "", conversation.note);
  }

  lines.push("", "## Messages", "");

  for (const message of conversation.messages) {
    lines.push(`### ${roleHeadings[message.role]}`, "");
    if (message.createdAt) {
      lines.push(`_Created at: ${message.createdAt}_`, "");
    }
    lines.push(markdownEscape(message.content), "");
  }

  return lines.join("\n").trimEnd() + "\n";
}
