import { requireApiToken } from "@/lib/api-auth";
import { deleteConversation } from "@/services/conversation-service";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const result = deleteConversation(id);

  if (!result.deleted) {
    return Response.json({ error: "对话不存在" }, { status: 404 });
  }

  return Response.json({ ok: true, ...result });
}
