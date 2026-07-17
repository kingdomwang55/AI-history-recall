import { requireApiToken } from "@/lib/api-auth";
import { getHealthReport, redactHealthReport } from "@/services/health-check-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  return Response.json({ health: redactHealthReport(getHealthReport()) });
}
