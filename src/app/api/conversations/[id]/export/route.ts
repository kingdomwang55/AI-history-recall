import { requireApiToken } from "@/lib/api-auth";
import { exportConversationJson, exportConversationMarkdown } from "@/services/export-service";

export const runtime = "nodejs";

function fileName(id: string, extension: "json" | "md") {
  return `conversation-${id}.${extension}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format") ?? "markdown";

  try {
    if (format === "json") {
      return Response.json(exportConversationJson(id), {
        headers: {
          "Content-Disposition": `attachment; filename="${fileName(id, "json")}"`
        }
      });
    }

    if (format === "markdown") {
      return new Response(exportConversationMarkdown(id), {
        headers: {
          "Content-Disposition": `attachment; filename="${fileName(id, "md")}"`,
          "Content-Type": "text/markdown; charset=utf-8"
        }
      });
    }

    return Response.json({ error: "不支持的导出格式" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 404 }
    );
  }
}
