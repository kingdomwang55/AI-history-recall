import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDaemonRouter } from "./daemon-router.ts";
import { configureDesktopRuntime, type DesktopRuntimeConfig } from "./runtime-config.ts";
import { processKnowledgeBatch } from "@/services/knowledge-worker-service";

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
  let closing: Promise<void> | null = null;
  let scheduler: ReturnType<typeof setInterval> | null = null;
  const server = http.createServer();

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
  server.on("request", createDaemonRouter({ token: config.token, onShutdown: () => void close() }));
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
      processKnowledgeBatch({ limit: 2 }).catch(() => undefined);
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
