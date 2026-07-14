import { requireApiToken } from "@/lib/api-auth";
import { updateConversationMetadata } from "@/services/conversation-service";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const body = (await request.json()) as {
    tags?: unknown;
    note?: unknown;
  };

  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag))
    : [];
  const note = typeof body.note === "string" ? body.note : "";

  try {
    const result = updateConversationMetadata(id, tags, note);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存失败" },
      { status: 400 }
    );
  }
}
