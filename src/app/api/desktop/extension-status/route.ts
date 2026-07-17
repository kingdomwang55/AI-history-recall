import { proxyDesktopDaemon } from "@/lib/desktop-daemon-proxy";

export const runtime = "nodejs";

export function GET(request: Request) {
  return proxyDesktopDaemon(request, "/api/desktop/extension-status");
}
