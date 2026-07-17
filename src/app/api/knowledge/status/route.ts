import { requireApiToken } from "@/lib/api-auth";
import { getKnowledgeModelStatus } from "@/services/knowledge-model-service";
import { getKnowledgeQueueStatus } from "@/services/knowledge-queue-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  return Response.json({ queue: getKnowledgeQueueStatus(), model: getKnowledgeModelStatus() });
}
