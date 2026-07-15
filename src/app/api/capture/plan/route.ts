import { createLlmCapturePlan } from "@/capture/llm-planner";
import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody<{
    instruction?: unknown;
  }>(request);
  if (error) return error;

  if (!body || typeof body.instruction !== "string" || !body.instruction.trim()) {
    return Response.json({ error: "请提供 instruction" }, { status: 400 });
  }

  try {
    const plan = await createLlmCapturePlan(body.instruction);
    return Response.json({ plan });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "生成抓取计划失败" },
      { status: 500 }
    );
  }
}
