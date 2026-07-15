import { runBrowserCapture } from "@/capture/browser-runner";
import { capturePlatformConfigs } from "@/capture/platforms";
import type { CapturePlan, CapturePlatform } from "@/capture/types";
import { isAllowedPlatformUrl, readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { importParsedConversations } from "@/services/import-service";

export const runtime = "nodejs";

function isPlatform(value: unknown): value is CapturePlatform {
  return typeof value === "string" && value in capturePlatformConfigs;
}

function parsePlan(value: unknown): CapturePlan | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as CapturePlan;
  if (!Array.isArray(raw.targets)) {
    return null;
  }

  const targets = raw.targets.filter(
    (target) =>
      target &&
      isPlatform(target.platform) &&
      typeof target.url === "string" &&
      isAllowedPlatformUrl(target.platform, target.url)
  );

  return {
    targets: targets.slice(0, 100),
    rateLimit: raw.rateLimit,
    importAfterCapture: raw.importAfterCapture !== false
  };
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const plan = parsePlan(body);

  if (!plan || plan.targets.length === 0) {
    return Response.json(
      { error: "请提供 targets，例如 [{ platform: 'qwen', url: 'https://www.qianwen.com/chat/...' }]" },
      { status: 400 }
    );
  }

  try {
    const capture = await runBrowserCapture(plan);
    const imported = plan.importAfterCapture
      ? importParsedConversations(
          capture.conversations,
          `browser-capture-${new Date().toISOString()}.json`,
          "browser_capture"
        )
      : null;

    return Response.json({
      capture,
      imported,
      setup: {
        chromeCdpUrl: process.env.CHROME_CDP_URL || "http://127.0.0.1:9222"
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "浏览器采集失败",
        hint:
          "需要先用远程调试端口启动 Chrome，并设置 CHROME_CDP_URL，例如 http://127.0.0.1:9222"
      },
      { status: 500 }
    );
  }
}
