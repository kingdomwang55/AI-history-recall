import { requireApiToken } from "@/lib/api-auth";
import { readJsonBody } from "@/lib/api-security";
import { processKnowledgeBatch } from "@/services/knowledge-worker-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  const { data, error } = await readJsonBody(request);
  if (error) return error;
  const requested =
    data && typeof data === "object" && typeof (data as { limit?: unknown }).limit === "number"
      ? (data as { limit: number }).limit
      : 1;
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(10, Math.floor(requested))) : 1;
  return Response.json(await processKnowledgeBatch({ limit }));
}
