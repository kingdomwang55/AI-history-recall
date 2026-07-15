import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { runFullCaptureWorkflow, type FullCaptureOptions } from "@/services/capture-full-service";

export const runtime = "nodejs";

function parseOptions(value: unknown): FullCaptureOptions {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const raw = value as Record<string, unknown>;

  return {
    instruction: typeof raw.instruction === "string" ? raw.instruction : undefined,
    platforms: Array.isArray(raw.platforms) ? (raw.platforms as FullCaptureOptions["platforms"]) : undefined,
    launchChrome: raw.launchChrome === true,
    openPlatforms: raw.openPlatforms === true,
    preflight: raw.preflight !== false,
    createJob: raw.createJob === true,
    runUntilIdle: raw.runUntilIdle === true,
    batchSize: typeof raw.batchSize === "number" ? raw.batchSize : undefined,
    maxBatches: typeof raw.maxBatches === "number" ? raw.maxBatches : undefined,
    batchDelayMs: typeof raw.batchDelayMs === "number" ? raw.batchDelayMs : undefined,
    maxAttempts: typeof raw.maxAttempts === "number" ? raw.maxAttempts : undefined
  };
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  try {
    const result = await runFullCaptureWorkflow(parseOptions(body));
    return Response.json(result, {
      status: result.preflight && !result.preflight.status.ok ? 500 : 200
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "全量采集向导执行失败",
        hint: "先确认 Chrome CDP 可用、四个平台已打开且已登录，再创建或执行采集任务。"
      },
      { status: 500 }
    );
  }
}
