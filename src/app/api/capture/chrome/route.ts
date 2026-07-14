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

  const body = await request.json().catch(() => null);
  const options =
    typeof body === "object" && body !== null
      ? {
          port:
            typeof (body as { port?: unknown }).port === "number"
              ? (body as { port: number }).port
              : undefined,
          userDataDir:
            typeof (body as { userDataDir?: unknown }).userDataDir === "string"
              ? (body as { userDataDir: string }).userDataDir
              : undefined,
          chromePath:
            typeof (body as { chromePath?: unknown }).chromePath === "string"
              ? (body as { chromePath: string }).chromePath
              : undefined
        }
      : {};

  try {
    const result = await launchChromeCdp(options);
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
