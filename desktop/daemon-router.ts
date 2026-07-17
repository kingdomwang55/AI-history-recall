import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type WebSocket from "ws";
import * as healthRoute from "@/app/api/health/route";
import * as captureRoute from "@/app/api/extension/capture-page/route";
import * as discoveryRoute from "@/app/api/extension/discovery-run/route";
import * as filterRoute from "@/app/api/extension/filter-targets/route";
import * as planRoute from "@/app/api/extension/plan/route";
import * as syncRoute from "@/app/api/extension/sync-state/route";
import * as knowledgeProcessRoute from "@/app/api/knowledge/process/route";
import * as knowledgeStatusRoute from "@/app/api/knowledge/status/route";
import * as desktopStatusRoute from "@/app/api/desktop/status/route";
import { completeOnboardingStep } from "@/services/desktop-settings-service";

const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const EXTENSION_PAIRING_BUILD_ID = "desktop-websocket-20260717";

type RouteHandler = (request: Request) => Response | Promise<Response>;
type RouteMethods = Record<string, RouteHandler>;

const routes = new Map<string, RouteMethods>([
  ["/api/health", { GET: healthRoute.GET }],
  ["/api/extension/capture-page", { POST: captureRoute.POST }],
  ["/api/extension/discovery-run", { POST: discoveryRoute.POST }],
  ["/api/extension/filter-targets", { GET: filterRoute.GET, POST: filterRoute.POST }],
  ["/api/extension/plan", { POST: planRoute.POST }],
  ["/api/extension/sync-state", { GET: syncRoute.GET, POST: syncRoute.POST }],
  ["/api/knowledge/process", { POST: knowledgeProcessRoute.POST }],
  ["/api/knowledge/status", { GET: knowledgeStatusRoute.GET }],
  ["/api/desktop/status", { GET: desktopStatusRoute.GET, POST: desktopStatusRoute.POST }]
]);

function isLoopbackRemote(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function tokenDigest(value: string) {
  return createHash("sha256").update(value).digest();
}

function requestToken(request: IncomingMessage) {
  const direct = request.headers["x-aihr-api-token"];
  if (typeof direct === "string") return direct.trim();
  const authorization = request.headers.authorization?.trim() ?? "";
  return authorization.toLocaleLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function tokenMatches(actual: string, expected: string) {
  return timingSafeEqual(tokenDigest(actual), tokenDigest(expected));
}

function json(response: ServerResponse, status: number, body: unknown) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(content),
    "cache-control": "no-store"
  });
  response.end(content);
}

async function readBody(request: IncomingMessage) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { oversized: true, body: "" };
  const chunks: Buffer[] = [];
  let length = 0;
  let oversized = false;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > MAX_BODY_BYTES) {
      oversized = true;
      continue;
    }
    chunks.push(value);
  }
  return { oversized, body: oversized ? "" : Buffer.concat(chunks).toString("utf8") };
}

async function sendWebResponse(nodeResponse: ServerResponse, webResponse: Response) {
  const body = Buffer.from(await webResponse.arrayBuffer());
  const headers = Object.fromEntries(webResponse.headers.entries());
  nodeResponse.writeHead(webResponse.status, { ...headers, "content-length": body.length });
  nodeResponse.end(body);
}

export interface DaemonMetrics {
  startedAt: string;
  schedulerWakeups: number;
  unconfiguredOutboundRequests: number;
}

export type DaemonRouter = ReturnType<typeof createDaemonRouter>;

export function createDaemonRouter(options: {
  token: string;
  onShutdown: () => void;
  getMetrics?: () => DaemonMetrics;
}) {
  type BridgeCommand = { id: string; message: Record<string, unknown> };
  const pendingCommands: BridgeCommand[] = [];
  const commandResults = new Map<string, (result: unknown) => void>();
  let extensionLastSeenAt = 0;
  let extensionMeta: Record<string, unknown> = {};
  let wakeExtensionPoll: (() => void) | null = null;
  let extensionSocket: WebSocket | null = null;

  async function waitForExtensionCommand() {
    if (!pendingCommands.length) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (wakeExtensionPoll === wake) wakeExtensionPoll = null;
          resolve();
        }, 15_000);
        const wake = () => {
          clearTimeout(timer);
          if (wakeExtensionPoll === wake) wakeExtensionPoll = null;
          resolve();
        };
        wakeExtensionPoll = wake;
      });
    }
    return pendingCommands.shift() ?? null;
  }

  const daemonRouter = async function daemonRouter(request: IncomingMessage, response: ServerResponse) {
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Request timeout")));
    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      json(response, 403, { error: "Loopback requests only" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/ready" && request.method === "GET") {
      json(response, 200, { ready: true, pid: process.pid });
      return;
    }
    if (url.pathname === "/api/desktop/pair-extension") {
      if (request.method !== "POST") {
        request.resume();
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const origin = request.headers.origin ?? "";
      const buildId = request.headers["x-aihr-extension-build"];
      if (
        buildId !== EXTENSION_PAIRING_BUILD_ID ||
        (origin && !origin.startsWith("chrome-extension://"))
      ) {
        request.resume();
        json(response, 403, { error: "Unrecognized browser extension" });
        return;
      }
      request.resume();
      completeOnboardingStep("extension");
      json(response, 200, { ok: true, token: options.token });
      return;
    }
    if (!tokenMatches(requestToken(request), options.token)) {
      request.resume();
      json(response, 401, { error: "Missing or invalid local API token" });
      return;
    }
    if (url.pathname === "/api/desktop/extension-status" && request.method === "GET") {
      json(response, 200, {
        connected: extensionSocket?.readyState === 1 || Date.now() - extensionLastSeenAt < 25_000,
        transport: "websocket",
        transportVersion: 1,
        lastSeenAt: extensionLastSeenAt ? new Date(extensionLastSeenAt).toISOString() : null,
        ...extensionMeta
      });
      return;
    }
    if (url.pathname === "/api/desktop/extension-bridge") {
      if (request.method === "GET") {
        extensionLastSeenAt = Date.now();
        extensionMeta = {
          version: request.headers["x-aihr-extension-version"],
          buildId: request.headers["x-aihr-extension-build"]
        };
        json(response, 200, { command: await waitForExtensionCommand() });
        return;
      }
      if (request.method !== "POST") {
        request.resume();
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const bridgeBody = await readBody(request);
      if (bridgeBody.oversized) {
        json(response, 413, { error: "Request body too large" });
        return;
      }
      let payload: { kind?: string; id?: string; message?: Record<string, unknown>; result?: unknown };
      try {
        payload = JSON.parse(bridgeBody.body || "{}");
      } catch {
        json(response, 400, { error: "Invalid bridge payload" });
        return;
      }
      if (payload.kind === "result" && payload.id) {
        extensionLastSeenAt = Date.now();
        commandResults.get(payload.id)?.(payload.result);
        commandResults.delete(payload.id);
        json(response, 200, { ok: true });
        return;
      }
      if (payload.kind !== "command" || !payload.message || typeof payload.message !== "object") {
        json(response, 400, { error: "Invalid bridge action" });
        return;
      }
      if (Date.now() - extensionLastSeenAt >= 25_000) {
        json(response, 503, { error: "扩展已配对，但后台连接尚未建立；请刷新扩展后重试。" });
        return;
      }
      const command = { id: randomUUID(), message: payload.message };
      if (extensionSocket?.readyState === 1) {
        extensionSocket.send(JSON.stringify({ type: "command", command }));
      } else {
        pendingCommands.push(command);
        wakeExtensionPoll?.();
      }
      const result = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
          commandResults.delete(command.id);
          resolve({ ok: false, error: "扩展执行命令超时" });
        }, 12_000);
        commandResults.set(command.id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      json(response, 200, result);
      return;
    }
    if (url.pathname === "/metrics" && request.method === "GET") {
      json(response, 200, options.getMetrics?.() ?? {
        startedAt: new Date().toISOString(),
        schedulerWakeups: 0,
        unconfiguredOutboundRequests: 0
      });
      return;
    }
    if (url.pathname === "/shutdown") {
      if (request.method !== "POST") {
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 200, { ok: true });
      response.once("finish", options.onShutdown);
      return;
    }

    const methods = routes.get(url.pathname);
    if (!methods) {
      json(response, 404, { error: "Not found" });
      return;
    }
    const handler = methods[request.method ?? ""];
    if (!handler) {
      json(response, 405, { error: "Method not allowed", allow: Object.keys(methods) });
      return;
    }
    const body = request.method === "GET" || request.method === "HEAD" ? { oversized: false, body: "" } : await readBody(request);
    if (body.oversized) {
      json(response, 413, { error: "Request body too large" });
      return;
    }
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
      }
      headers.set("X-AIHR-API-Token", options.token);
      const webRequest = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        ...(body.body ? { body: body.body } : {})
      });
      await sendWebResponse(response, await handler(webRequest));
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : "Daemon request failed" });
    }
  };

  daemonRouter.connectExtensionSocket = (socket: WebSocket, meta: Record<string, unknown>) => {
    extensionSocket?.close(1000, "Replaced by a newer extension connection");
    extensionSocket = socket;
    extensionMeta = meta;
    extensionLastSeenAt = Date.now();
    socket.on("message", (raw) => {
      extensionLastSeenAt = Date.now();
      try {
        const payload = JSON.parse(raw.toString()) as { type?: string; id?: string; result?: unknown };
        if (payload.type === "heartbeat") return;
        if (payload.type === "result" && payload.id) {
          commandResults.get(payload.id)?.(payload.result);
          commandResults.delete(payload.id);
        }
      } catch {
        // Ignore malformed messages from the local extension connection.
      }
    });
    socket.on("close", () => {
      if (extensionSocket === socket) extensionSocket = null;
    });
    while (pendingCommands.length && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "command", command: pendingCommands.shift() }));
    }
  };

  return daemonRouter;
}
