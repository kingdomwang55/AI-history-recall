import type { MessageRole, ParsedMessage } from "@/types/conversation";
import { normalizeMessages, normalizeRole } from "./base";

const roleHeaderPattern =
  /^\s{0,3}(?:#{1,6}\s*)?(user|assistant|system|human|ai|bot|用户|助手|系统|问题|回答|问|答|q|a)\s*[:：]?\s*$/i;

const inlineRolePattern =
  /^\s{0,3}(?:[-*]\s*)?(user|assistant|system|human|ai|bot|用户|助手|系统|问题|回答|问|答|q|a)\s*[:：]\s*(.*)$/i;

export function parseRoleBlocks(content: string): ParsedMessage[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const messages: ParsedMessage[] = [];
  let currentRole: MessageRole | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      messages.push({
        role: currentRole ?? "unknown",
        content: body
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(roleHeaderPattern);
    if (headerMatch) {
      flush();
      currentRole = normalizeRole(headerMatch[1]);
      continue;
    }

    const inlineMatch = line.match(inlineRolePattern);
    if (inlineMatch) {
      flush();
      currentRole = normalizeRole(inlineMatch[1]);
      if (inlineMatch[2]?.trim()) {
        buffer.push(inlineMatch[2]);
      }
      continue;
    }

    buffer.push(line);
  }

  flush();

  const normalized = normalizeMessages(messages);
  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = content.trim();
  return fallback
    ? [
        {
          role: "unknown",
          content: fallback
        }
      ]
    : [];
}
