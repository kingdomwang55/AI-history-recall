import { discoverBrowserHistoryTargets } from "@/capture/browser-runner";
import { capturePlatformConfigs } from "@/capture/platforms";
import type { CaptureDiscoveryOptions, CapturePlatform } from "@/capture/types";
import { requireApiToken } from "@/lib/api-auth";

export const runtime = "nodejs";

function isPlatform(value: unknown): value is CapturePlatform {
  return typeof value === "string" && value in capturePlatformConfigs;
}

function parseOptions(value: unknown): CaptureDiscoveryOptions | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as {
    platform?: unknown;
    maxItems?: unknown;
    maxScrolls?: unknown;
    stopAfterNoNewScrolls?: unknown;
    exhaustive?: unknown;
    startUrl?: unknown;
    rateLimit?: CaptureDiscoveryOptions["rateLimit"];
  };

  if (!isPlatform(raw.platform)) {
    return null;
  }

  return {
    platform: raw.platform,
    maxItems: typeof raw.maxItems === "number" ? raw.maxItems : undefined,
    maxScrolls: typeof raw.maxScrolls === "number" ? raw.maxScrolls : undefined,
    stopAfterNoNewScrolls:
      typeof raw.stopAfterNoNewScrolls === "number" ? raw.stopAfterNoNewScrolls : undefined,
    exhaustive: raw.exhaustive === true,
    startUrl: typeof raw.startUrl === "string" ? raw.startUrl : undefined,
    rateLimit: raw.rateLimit
  };
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const options = parseOptions(body);

  if (!options) {
    return Response.json(
      {
        error:
          "请提供发现配置，例如 { platform: 'qwen', maxItems: 20, maxScrolls: 4 }"
      },
      { status: 400 }
    );
  }

  try {
    const discovery = await discoverBrowserHistoryTargets(options);
    return Response.json({
      discovery,
      plan: {
        targets: discovery.targets,
        importAfterCapture: true
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "历史列表发现失败",
        hint:
          "需要先用远程调试端口启动 Chrome，并设置 CHROME_CDP_URL，例如 http://127.0.0.1:9222"
      },
      { status: 500 }
    );
  }
}
