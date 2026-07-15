import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import {
  getCaptureJob,
  runCaptureJobBatch,
  runCaptureJobUntilIdle
} from "@/services/capture-job-service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const job = getCaptureJob(id);

  if (!job) {
    return Response.json({ error: "采集任务不存在" }, { status: 404 });
  }

  return Response.json({ job });
}

export async function POST(request: Request, context: RouteContext) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const batchSize =
    typeof body === "object" && body !== null && typeof (body as { batchSize?: unknown }).batchSize === "number"
      ? (body as { batchSize: number }).batchSize
      : 5;
  const maxAttempts =
    typeof body === "object" && body !== null && typeof (body as { maxAttempts?: unknown }).maxAttempts === "number"
      ? (body as { maxAttempts: number }).maxAttempts
      : 3;
  const runUntilIdle =
    typeof body === "object" && body !== null && (body as { runUntilIdle?: unknown }).runUntilIdle === true;
  const maxBatches =
    typeof body === "object" && body !== null && typeof (body as { maxBatches?: unknown }).maxBatches === "number"
      ? (body as { maxBatches: number }).maxBatches
      : 10;
  const batchDelayMs =
    typeof body === "object" && body !== null && typeof (body as { batchDelayMs?: unknown }).batchDelayMs === "number"
      ? (body as { batchDelayMs: number }).batchDelayMs
      : 12000;

  try {
    const result = runUntilIdle
      ? await runCaptureJobUntilIdle(id, { batchSize, maxAttempts, maxBatches, batchDelayMs })
      : await runCaptureJobBatch(id, { batchSize, maxAttempts });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "执行采集任务失败",
        hint: "确认 Chrome CDP 已启动且已登录对应 AI 平台；可以降低 batchSize 后重试。"
      },
      { status: 500 }
    );
  }
}
