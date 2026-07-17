import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { captureExtensionPayload, ExtensionCaptureError } from "@/services/extension-capture-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  try {
    return Response.json(captureExtensionPayload(body));
  } catch (captureError) {
    const status = captureError instanceof ExtensionCaptureError ? captureError.status : 500;
    return Response.json(
      { error: captureError instanceof Error ? captureError.message : "扩展采集失败" },
      { status }
    );
  }
}
