import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "@/lib/db";

const MAX_RESTORE_BYTES = 512 * 1024 * 1024;

function databasePath() {
  return path.resolve(process.env.AIHR_DB_PATH || path.join(process.cwd(), "data", "ai-history-recall.sqlite"));
}

export function createDesktopBackup() {
  const db = getDb();
  db.pragma("wal_checkpoint(FULL)");
  const filePath = databasePath();
  return {
    bytes: fs.readFileSync(filePath),
    filename: `ai-history-recall-${new Date().toISOString().slice(0, 10)}.sqlite`
  };
}

function validateDatabase(filePath: string) {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = candidate.pragma("quick_check", { simple: true });
    if (result !== "ok") throw new Error(`SQLite quick_check: ${String(result)}`);
    const tables = candidate
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('conversations', 'messages')")
      .all() as Array<{ name: string }>;
    if (tables.length !== 2) throw new Error("备份缺少对话数据表");
  } finally {
    candidate.close();
  }
}

export async function restoreDesktopBackup(file: File) {
  if (file.size <= 0 || file.size > MAX_RESTORE_BYTES) throw new Error("备份文件大小无效");
  const target = databasePath();
  const temporary = `${target}.restore-${process.pid}`;
  const rollback = `${target}.rollback-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.writeFileSync(temporary, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  try {
    validateDatabase(temporary);
    getDb().pragma("wal_checkpoint(FULL)");
    closeDb();
    if (fs.existsSync(target)) fs.copyFileSync(target, rollback);
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${target}${suffix}`, { force: true });
    fs.renameSync(temporary, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Best effort on Windows and filesystems without POSIX permissions.
    }
    getDb();
    return { restored: true, rollbackCreated: fs.existsSync(rollback) };
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(rollback)) fs.copyFileSync(rollback, target);
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
