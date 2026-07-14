import type { Message, MessageRole } from "@/types/conversation";

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function roleLabel(role: MessageRole) {
  const labels: Record<MessageRole, string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    unknown: "Unknown"
  };

  return labels[role];
}

export function platformLabel(platform: string) {
  const labels: Record<string, string> = {
    generic_json: "Generic JSON",
    generic_markdown: "Generic Markdown",
    generic_text: "Generic TXT",
    generic_html: "Generic HTML",
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    claude: "Claude",
    deepseek: "DeepSeek",
    qwen: "通义千问",
    tongyi: "通义千问"
  };

  return labels[platform] ?? platform;
}

export function buildConversationText(title: string, messages: Message[]) {
  const body = messages
    .map((message) => {
      return `[${roleLabel(message.role)}]\n${message.content.trim()}`;
    })
    .join("\n\n");

  return `${title}\n\n${body}`;
}

export function truncateText(value: string, maxLength = 80) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}…`;
}
