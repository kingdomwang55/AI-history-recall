import http from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDaemonRouter } from "./daemon-router.ts";
import { configureDesktopRuntime, type DesktopRuntimeConfig } from "./runtime-config.ts";
import { processKnowledgeBatch } from "@/services/knowledge-worker-service";
import { applyDesktopSettingsEnvironment, getDesktopSettings } from "@/services/desktop-settings-service";

export interface StartDaemonOptions extends DesktopRuntimeConfig {
  scheduler?: boolean;
}

export interface RunningDaemon {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startDaemon(options: StartDaemonOptions): Promise<RunningDaemon> {
  const config = configureDesktopRuntime(options);
  applyDesktopSettingsEnvironment();
  let closing: Promise<void> | null = null;
  let scheduler: ReturnType<typeof setInterval> | null = null;
  const metrics = {
    startedAt: new Date().toISOString(),
    schedulerWakeups: 0,
    unconfiguredOutboundRequests: 0
  };
  const server = http.createServer();
  const webSockets = new WebSocketServer({ noServer: true });

  const close = () => {
    if (closing) return closing;
    if (scheduler) clearInterval(scheduler);
    closing = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
    return closing;
  };
  const router = createDaemonRouter({
    token: config.token,
    onShutdown: () => void close(),
    getMetrics: () => ({ ...metrics })
  });
  server.on("request", router);
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${config.host}`);
    if (
      url.pathname !== "/api/desktop/extension-socket" ||
      url.searchParams.get("token") !== config.token
    ) {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      router.connectExtensionSocket(webSocket, {
        version: url.searchParams.get("version") || undefined,
        buildId: url.searchParams.get("buildId") || undefined
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  if (options.scheduler !== false) {
    scheduler = setInterval(() => {
      const settings = applyDesktopSettingsEnvironment(getDesktopSettings());
      if (settings.knowledgeProcessing) {
        metrics.schedulerWakeups += 1;
        processKnowledgeBatch({ limit: 2 }).catch(() => undefined);
      }
    }, 60_000);
    scheduler.unref();
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop daemon did not expose a TCP address.");
  return { host: config.host, port: address.port, url: `http://${config.host}:${address.port}`, close };
}

async function main() {
  const dataDir = process.env.AIHR_DATA_DIR || path.join(process.cwd(), "data");
  const daemon = await startDaemon({
    host: process.env.AIHR_DAEMON_HOST || "127.0.0.1",
    port: Number.parseInt(process.env.AIHR_DAEMON_PORT || "32145", 10),
    token: process.env.AIHR_API_TOKEN || "",
    dbPath: process.env.AIHR_DB_PATH || path.join(dataDir, "ai-history-recall.sqlite"),
    dataDir
  });
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid, port: daemon.port })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void daemon.close().then(() => process.exit(0)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
