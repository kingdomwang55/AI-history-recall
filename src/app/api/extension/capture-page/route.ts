import { inferPlatformFromUrl } from "@/capture/platforms";
import type { CapturePlatform } from "@/capture/types";
import { isAllowedPlatformUrl, readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { importParsedConversations } from "@/services/import-service";
import { markPlatformSyncSucceeded } from "@/services/platform-sync-service";
import type { MessageRole, ParsedConversation } from "@/types/conversation";

export const runtime = "nodejs";

function normalizeRole(role: unknown): MessageRole {
  return role === "user" || role === "assistant" || role === "system" || role === "unknown"
    ? role
    : "unknown";
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

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

  if (!platform || !url) {
    return Response.json({ error: "无法识别平台或 URL" }, { status: 400 });
  }

  if (!isAllowedPlatformUrl(platform as CapturePlatform, url)) {
    return Response.json({ error: "URL 与平台不匹配或不是受支持的 HTTPS 平台地址" }, { status: 400 });
  }

  const messages = (raw.messages ?? [])
    .slice(0, 400)
    .map((message) => ({
      role: normalizeRole(message.role),
      content: typeof message.content === "string" ? message.content.trim().slice(0, 200000) : "",
      createdAt: typeof message.createdAt === "string" ? message.createdAt : null
    }))
    .filter((message) => message.content.length > 0);

  if (messages.length === 0) {
    return Response.json({ error: "没有提取到有效消息" }, { status: 400 });
  }

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

  return Response.json({ imported });
}
