import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a UI port.");
  return {
    host: "127.0.0.1",
    port: address.port,
    release: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

export function uiEnvironment(config, address) {
  if (!config.dbPath || !config.token) throw new Error("Desktop UI requires database path and pairing token.");
  return {
    AIHR_DB_PATH: config.dbPath,
    AIHR_API_TOKEN: config.token,
    HOSTNAME: address.host,
    PORT: String(address.port)
  };
}

async function waitUntilListening(host, port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Desktop UI did not become ready within 20 seconds.");
}

export async function startUi(options = {}) {
  const uiDir = path.resolve(options.uiDir ?? path.dirname(fileURLToPath(import.meta.url)));
  const serverEntry = path.join(uiDir, "server.js");
  if (!fs.existsSync(serverEntry)) throw new Error(`Standalone UI server is missing: ${serverEntry}`);
  const reservation = await reserveLoopbackPort();
  const environment = uiEnvironment(
    {
      dbPath: options.dbPath ?? process.env.AIHR_DB_PATH,
      token: options.token ?? process.env.AIHR_API_TOKEN
    },
    reservation
  );
  await reservation.release();
  Object.assign(process.env, environment);
  process.chdir(uiDir);
  await import(pathToFileURL(serverEntry).href);
  await waitUntilListening(reservation.host, reservation.port);
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid, port: reservation.port })}\n`);
  return { host: reservation.host, port: reservation.port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startUi().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
