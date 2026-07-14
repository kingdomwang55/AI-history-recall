import { requireApiToken } from "@/lib/api-auth";
import { getCaptureAudit } from "@/services/capture-audit-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  return Response.json({ audit: getCaptureAudit() });
}
