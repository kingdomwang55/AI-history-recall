import { parseCdpPort, readJsonBody } from "@/lib/api-security";
import { requireApiToken } from "@/lib/api-auth";
import { getChromeCdpStatus, launchChromeCdp } from "@/services/chrome-cdp-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const status = await getChromeCdpStatus();
  return Response.json({ status });
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const { data: body, error } = await readJsonBody(request);
  if (error) return error;

  let port: number | undefined;
  try {
    port = parseCdpPort(
      typeof body === "object" && body !== null ? (body as { port?: unknown }).port : undefined
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chrome CDP 参数无效" },
      { status: 400 }
    );
  }

  try {
    const result = await launchChromeCdp({ port });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "启动 Chrome CDP 失败",
        hint:
          "确认已安装 Google Chrome；也可以设置 CHROME_PATH 指向 Chrome 可执行文件，或手动用 --remote-debugging-port=9222 启动。"
      },
      { status: 500 }
    );
  }
}
