import { inferPlatformFromUrl } from "@/capture/platforms";
import type { CapturePlatform } from "@/capture/types";
import { isAllowedPlatformUrl } from "@/lib/api-security";
import { importParsedConversations } from "@/services/import-service";
import { markPlatformSyncSucceeded } from "@/services/platform-sync-service";
import type { MessageRole, ParsedConversation } from "@/types/conversation";

export class ExtensionCaptureError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeRole(role: unknown): MessageRole {
  return role === "user" || role === "assistant" || role === "system" || role === "unknown"
    ? role
    : "unknown";
}

export function captureExtensionPayload(body: unknown) {
  if (typeof body !== "object" || body === null) throw new ExtensionCaptureError("Invalid payload");
  const raw = body as {
    url?: unknown;
    title?: unknown;
    platform?: unknown;
    messages?: Array<{ role?: unknown; content?: unknown; createdAt?: unknown }>;
  };
  const url = typeof raw.url === "string" ? raw.url : "";
  const platform =
    typeof raw.platform === "string" && ["chatgpt", "gemini", "deepseek", "qwen"].includes(raw.platform)
      ? raw.platform
      : inferPlatformFromUrl(url);
  if (!platform || !url) throw new ExtensionCaptureError("无法识别平台或 URL");
  if (!isAllowedPlatformUrl(platform as CapturePlatform, url)) {
    throw new ExtensionCaptureError("URL 与平台不匹配或不是受支持的 HTTPS 平台地址");
  }

  const messages = (raw.messages ?? [])
    .slice(0, 400)
    .map((message) => ({
      role: normalizeRole(message.role),
      content: typeof message.content === "string" ? message.content.trim().slice(0, 200000) : "",
      createdAt: typeof message.createdAt === "string" ? message.createdAt : null
    }))
    .filter((message) => message.content.length > 0);
  if (!messages.length) throw new ExtensionCaptureError("没有提取到有效消息");

  const conversation: ParsedConversation = {
    sourcePlatform: platform,
    sourceUrl: url,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : url,
    createdAt: null,
    updatedAt: null,
    tags: ["chrome-extension", platform],
    summary: `Captured from logged-in browser page ${url}`,
    messages
  };
  const imported = importParsedConversations(
    [conversation],
    `chrome-extension-${new Date().toISOString()}.json`,
    "chrome_extension"
  );
  markPlatformSyncSucceeded(platform as CapturePlatform, {
    newConversations: imported.importedConversations,
    newMessages: imported.importedMessages,
    lastSeenUrl: url
  });
  return { imported };
}
