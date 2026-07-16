import { getEmbeddingConfig } from "@/services/semantic-index-service";

export const runtime = "nodejs";

export async function GET() {
  const config = getEmbeddingConfig();

  return Response.json({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    timeoutMs: config.timeoutMs
  });
}
