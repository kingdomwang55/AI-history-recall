import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DESKTOP_NODE_MAJOR = 24;

const targetTriples = new Map([
  ["darwin-arm64", "aarch64-apple-darwin"],
  ["darwin-x64", "x86_64-apple-darwin"],
  ["win32-arm64", "aarch64-pc-windows-msvc"],
  ["win32-x64", "x86_64-pc-windows-msvc"]
]);

export function planDesktopResources({ platform = process.platform, arch = process.arch } = {}) {
  const targetTriple = targetTriples.get(`${platform}-${arch}`);
  if (!targetTriple) throw new Error(`Unsupported desktop target: ${platform}-${arch}`);
  const extension = platform === "win32" ? ".exe" : "";
  return {
    targetTriple,
    binaryName: `aihr-node-${targetTriple}${extension}`,
    resources: ["daemon/daemon.mjs", "ui/server.js"]
  };
}

export async function validateNodeRuntime(binaryPath) {
  if (!binaryPath) throw new Error("AIHR_DESKTOP_NODE_BINARY must point to a Node 24 runtime.");
  const resolved = path.resolve(binaryPath);
  if (!fs.existsSync(resolved)) throw new Error(`Desktop Node runtime does not exist: ${resolved}`);
  const { stdout } = await execFileAsync(resolved, ["--version"], { timeout: 10_000 });
  const major = Number.parseInt(stdout.trim().replace(/^v/, "").split(".")[0], 10);
  if (major !== DESKTOP_NODE_MAJOR) {
    throw new Error(`Desktop packaging requires Node 24, received ${stdout.trim() || "unknown"}.`);
  }
  return resolved;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}.`));
    });
  });
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Required desktop resource is missing: ${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true });
}

export async function prepareDesktopResources(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const manifest = planDesktopResources({ platform, arch });
  const nodeBinary = await validateNodeRuntime(
    options.nodeBinary ?? process.env.AIHR_DESKTOP_NODE_BINARY
  );

  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);

  const tauriDir = path.join(rootDir, "src-tauri");
  const resourcesDir = path.join(tauriDir, "resources");
  const daemonDir = path.join(resourcesDir, "daemon");
  const uiDir = path.join(resourcesDir, "ui");
  fs.rmSync(resourcesDir, { recursive: true, force: true });
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.mkdirSync(path.join(tauriDir, "binaries"), { recursive: true });

  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(rootDir, "desktop", "daemon-entry.ts")],
    outfile: path.join(daemonDir, "daemon.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["better-sqlite3"],
    banner: {
      js: "import { createRequire as __aihrCreateRequire } from 'node:module'; const require = __aihrCreateRequire(import.meta.url);"
    },
    sourcemap: false
  });

  copyDirectory(path.join(rootDir, ".next", "standalone"), uiDir);
  fs.rmSync(path.join(uiDir, "data"), { recursive: true, force: true });
  copyDirectory(path.join(rootDir, ".next", "static"), path.join(uiDir, ".next", "static"));
  if (fs.existsSync(path.join(rootDir, "public"))) {
    copyDirectory(path.join(rootDir, "public"), path.join(uiDir, "public"));
  }
  copyDirectory(path.join(rootDir, "extension"), path.join(resourcesDir, "extension"));
  fs.rmSync(path.join(resourcesDir, "extension", "config.js"), { force: true });
  fs.copyFileSync(path.join(rootDir, "desktop", "ui-entry.mjs"), path.join(uiDir, "launcher.mjs"));
  for (const packageName of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
    copyDirectory(
      path.join(rootDir, "node_modules", packageName),
      path.join(daemonDir, "node_modules", packageName)
    );
  }

  const runtimeDestination = path.join(tauriDir, "binaries", manifest.binaryName);
  fs.copyFileSync(nodeBinary, runtimeDestination);
  if (platform !== "win32") fs.chmodSync(runtimeDestination, 0o755);

  const manifestPath = path.join(resourcesDir, "desktop-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, nodeMajor: DESKTOP_NODE_MAJOR }, null, 2)}\n`);
  return { ...manifest, runtimeDestination, resourcesDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDesktopResources()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
