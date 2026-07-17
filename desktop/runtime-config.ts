import fs from "node:fs";
import path from "node:path";

export interface DesktopRuntimeConfig {
  host: string;
  port: number;
  token: string;
  dbPath: string;
  dataDir: string;
}

export function isLoopbackBindHost(host: string) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function configureDesktopRuntime(config: DesktopRuntimeConfig) {
  if (!isLoopbackBindHost(config.host)) throw new Error("Desktop daemon must bind to a loopback host.");
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error("Desktop daemon port must be between 0 and 65535.");
  }
  if (!config.token.trim()) throw new Error("Desktop daemon pairing token is required.");
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(config.dataDir, 0o700);
  } catch {
    // Windows and some filesystems do not expose POSIX modes.
  }
  const resolvedDbPath = path.resolve(config.dbPath);
  process.env.AIHR_DB_PATH = resolvedDbPath;
  process.env.AIHR_API_TOKEN = config.token;
  return { ...config, dbPath: resolvedDbPath, dataDir: path.resolve(config.dataDir) };
}
