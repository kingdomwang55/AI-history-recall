import { readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { openChromePlatformPages } from "@/services/chrome-cdp-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  const platforms =
    typeof body === "object" && body !== null
      ? (body as { platforms?: unknown }).platforms
      : undefined;

  const result = await openChromePlatformPages(platforms);
  const status = result.status.ok ? 200 : 500;

  return Response.json(
    {
      ...result,
      hint: result.status.ok
        ? "平台页面已在受控 Chrome 中打开。请确认登录状态，然后创建可恢复采集任务。"
        : "需要先启动 Chrome CDP。可在 /capture 页面点击“启动本地 Chrome”。"
    },
    { status }
  );
}
