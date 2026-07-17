import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const THRESHOLDS = Object.freeze({ cpuAverage: 0.5, rssMb: 120, dbWakeups: 5, outboundRequests: 0 });

export function evaluateBudget(metrics) {
  const failures = [];
  if (!Number.isFinite(metrics.cpuAverage) || metrics.cpuAverage >= THRESHOLDS.cpuAverage) failures.push("cpuAverage");
  if (!Number.isFinite(metrics.rssMb) || metrics.rssMb > THRESHOLDS.rssMb) failures.push("rssMb");
  if (!Number.isFinite(metrics.dbWakeups) || metrics.dbWakeups > THRESHOLDS.dbWakeups) failures.push("dbWakeups");
  if (!Number.isFinite(metrics.outboundRequests) || metrics.outboundRequests > THRESHOLDS.outboundRequests) failures.push("outboundRequests");
  return { ok: failures.length === 0, thresholds: { ...THRESHOLDS }, failures };
}

export function summarizeSamples(samples) {
  if (!samples.length) return { cpuAverage: Number.NaN, rssMb: Number.NaN };
  const cpuAverage = samples.reduce((total, sample) => total + sample.cpu, 0) / samples.length;
  const rssMb = Math.max(...samples.map((sample) => sample.rssMb));
  return { cpuAverage: Number(cpuAverage.toFixed(3)), rssMb: Number(rssMb.toFixed(1)) };
}

async function sampleUnix(pids) {
  const { stdout } = await execFileAsync("ps", ["-o", "%cpu=,rss=", "-p", pids.join(",")]);
  return stdout.trim().split("\n").filter(Boolean).reduce(
    (total, line) => {
      const [cpu, rss] = line.trim().split(/\s+/).map(Number);
      return { cpu: total.cpu + (cpu || 0), rssMb: total.rssMb + (rss || 0) / 1024 };
    },
    { cpu: 0, rssMb: 0 }
  );
}

async function sampleWindows(pids) {
  const ids = pids.join(",");
  const script = `$ids=@(${ids}); Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$ids -contains $_.IDProcess} | Select-Object PercentProcessorTime,WorkingSetPrivate | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script]);
  const parsed = JSON.parse(stdout || "[]");
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.reduce(
    (total, row) => ({
      cpu: total.cpu + Number(row.PercentProcessorTime || 0),
      rssMb: total.rssMb + Number(row.WorkingSetPrivate || 0) / 1024 / 1024
    }),
    { cpu: 0, rssMb: 0 }
  );
}

async function parentPid(pid) {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`
    ]);
    return Number.parseInt(stdout.trim(), 10);
  }
  const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(pid)]);
  return Number.parseInt(stdout.trim(), 10);
}

async function daemonJson(baseUrl, token, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { "X-AIHR-API-Token": token } : undefined,
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`Daemon ${pathname} returned ${response.status}.`);
  return response.json();
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function reportPath() {
  if (process.env.AIHR_DESKTOP_RESOURCE_REPORT) return path.resolve(process.env.AIHR_DESKTOP_RESOURCE_REPORT);
  const dbPath = process.env.AIHR_DB_PATH
    ? path.resolve(process.env.AIHR_DB_PATH)
    : path.resolve("data", "ai-history-recall.sqlite");
  return path.join(path.dirname(dbPath), "desktop-resource-report.json");
}

export async function measureDesktopIdle(options = {}) {
  const baseUrl = options.baseUrl || process.env.AIHR_DAEMON_URL || "http://127.0.0.1:32145";
  const token = options.token || process.env.AIHR_API_TOKEN || "";
  if (!token) throw new Error("AIHR_API_TOKEN is required to read daemon metrics.");
  const durationMs = Number(options.durationMs ?? argument("--duration-ms", "300000"));
  const intervalMs = Number(options.intervalMs ?? argument("--interval-ms", "5000"));
  if (!Number.isFinite(durationMs) || durationMs < 1000 || !Number.isFinite(intervalMs) || intervalMs < 250) {
    throw new Error("Measurement duration or interval is invalid.");
  }

  const ready = await daemonJson(baseUrl, "", "/ready");
  const supervisorPid = Number(options.supervisorPid || process.env.AIHR_DESKTOP_PID || (await parentPid(ready.pid)));
  const pids = [...new Set([supervisorPid, Number(ready.pid)].filter((pid) => Number.isInteger(pid) && pid > 0))];
  const initialMetrics = await daemonJson(baseUrl, token, "/metrics");
  const samples = [];
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationMs;
  do {
    samples.push(process.platform === "win32" ? await sampleWindows(pids) : await sampleUnix(pids));
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  } while (Date.now() <= deadline);
  const finalMetrics = await daemonJson(baseUrl, token, "/metrics");
  const summary = summarizeSamples(samples);
  const metrics = {
    ...summary,
    dbWakeups: Math.max(0, Number(finalMetrics.schedulerWakeups) - Number(initialMetrics.schedulerWakeups)),
    outboundRequests: Math.max(
      0,
      Number(finalMetrics.unconfiguredOutboundRequests) - Number(initialMetrics.unconfiguredOutboundRequests)
    )
  };
  const budget = evaluateBudget(metrics);
  const report = {
    version: 1,
    mode: "idle-tray",
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    sampleCount: samples.length,
    processCount: pids.length,
    metrics,
    budget
  };
  const output = options.output || reportPath();
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureDesktopIdle()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      if (!report.budget.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
