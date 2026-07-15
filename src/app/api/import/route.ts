import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  requireBodySizeLimit
} from "@/lib/api-security";
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

  const sizeError = requireBodySizeLimit(request, MAX_UPLOAD_TOTAL_BYTES);
  if (sizeError) return sizeError;

  const formData = await request.formData();
  const files = formData.getAll("files").filter(isUploadFile);

  if (files.length === 0) {
    return Response.json({ error: "请选择至少一个文件" }, { status: 400 });
  }

  if (files.length > MAX_UPLOAD_FILES) {
    return Response.json({ error: `一次最多导入 ${MAX_UPLOAD_FILES} 个文件` }, { status: 413 });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    return Response.json({ error: "导入文件总大小不能超过 25 MB" }, { status: 413 });
  }

  const results = [];

  for (const file of files) {
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      results.push({
        ok: false,
        fileName: file.name,
        adapter: null,
        importedConversations: 0,
        importedMessages: 0,
        conversationIds: [],
        errors: [`单个文件不能超过 10 MB：${file.name}`]
      });
      continue;
    }

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
