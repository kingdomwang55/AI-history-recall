import { proxyDesktopDaemon } from "@/lib/desktop-daemon-proxy";

export const runtime = "nodejs";

export function POST(request: Request) {
  return proxyDesktopDaemon(request, "/api/desktop/extension-bridge");
}
