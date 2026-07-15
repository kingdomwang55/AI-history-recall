import { createExtensionCapturePlan } from "@/capture/extension-agent";
import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const instruction =
    typeof body === "object" && body !== null && typeof (body as { instruction?: unknown }).instruction === "string"
      ? (body as { instruction: string }).instruction
      : "";

  if (!instruction.trim()) {
    return Response.json({ error: "instruction is required" }, { status: 400 });
  }

  try {
    const plan = await createExtensionCapturePlan(instruction);
    return Response.json({
      plan,
      llmPlanner: Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY)
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create extension capture plan"
      },
      { status: 500 }
    );
  }
}
