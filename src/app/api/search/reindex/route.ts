import { requireApiToken } from "@/lib/api-auth";
import { reindexSearch } from "@/services/reindex-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  return Response.json({ ok: true, ...reindexSearch() });
}
