import { requireApiToken } from "@/lib/api-auth";
import { importFile } from "@/services/import-service";

export const runtime = "nodejs";

function isUploadFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const formData = await request.formData();
  const files = formData.getAll("files").filter(isUploadFile);

  if (files.length === 0) {
    return Response.json({ error: "请选择至少一个文件" }, { status: 400 });
  }

  const results = [];

  for (const file of files) {
    const content = await file.text();
    results.push(
      await importFile({
        fileName: file.name,
        mimeType: file.type,
        content
      })
    );
  }

  return Response.json({
    results,
    total: {
      conversations: results.reduce(
        (sum, item) => sum + item.importedConversations,
        0
      ),
      messages: results.reduce((sum, item) => sum + item.importedMessages, 0)
    }
  });
}
