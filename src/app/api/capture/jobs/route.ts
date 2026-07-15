import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { createCaptureJob, listCaptureJobs } from "@/services/capture-job-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  return Response.json({ jobs: listCaptureJobs() });
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const instruction =
    typeof body === "object" && body !== null && typeof (body as { instruction?: unknown }).instruction === "string"
      ? (body as { instruction: string }).instruction.trim()
      : "";

  if (!instruction) {
    return Response.json(
      {
        error: "请提供 instruction，例如：发现 ChatGPT、Gemini、DeepSeek、通义千问全部历史并创建采集任务。"
      },
      { status: 400 }
    );
  }

  try {
    const result = await createCaptureJob(instruction);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "创建采集任务失败",
        hint:
          "如果任务需要发现历史列表，请先用远程调试端口启动 Chrome，并设置 CHROME_CDP_URL。只导入显式 URL 时不需要发现步骤。"
      },
      { status: 500 }
    );
  }
}
