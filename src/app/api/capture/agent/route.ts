import { createLlmAgentPlan, runCaptureAgent } from "@/capture/agent";
import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";

export const runtime = "nodejs";

function parseInstruction(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return "";
  }

  const raw = value as { instruction?: unknown; dryRun?: unknown };
  return typeof raw.instruction === "string" ? raw.instruction.trim() : "";
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const instruction = parseInstruction(body);
  const dryRun = typeof body === "object" && body !== null && (body as { dryRun?: unknown }).dryRun === true;

  if (!instruction) {
    return Response.json(
      {
        error: "请提供 instruction，例如：抓取通义千问最近 10 条历史对话并导入本地。"
      },
      { status: 400 }
    );
  }

  try {
    if (dryRun) {
      const plan = await createLlmAgentPlan(instruction);
      return Response.json({ plan });
    }

    const result = await runCaptureAgent(instruction);
    return Response.json({
      ...result,
      setup: {
        chromeCdpUrl: process.env.CHROME_CDP_URL || "http://127.0.0.1:9222",
        llmPlanner: Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY)
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "浏览器 Agent 执行失败",
        hint:
          "需要先用远程调试端口启动 Chrome，并设置 CHROME_CDP_URL，例如 http://127.0.0.1:9222。若启用模型规划，还需要 LLM_BASE_URL 和 LLM_API_KEY。"
      },
      { status: 500 }
    );
  }
}
