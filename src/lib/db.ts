import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type GlobalWithDb = typeof globalThis & {
  aiHistoryRecallDb?: Database.Database;
};

const globalForDb = globalThis as GlobalWithDb;

export function getDb() {
  if (!globalForDb.aiHistoryRecallDb) {
    const dbPath =
      process.env.AIHR_DB_PATH ??
      path.join(process.cwd(), "data", "ai-history-recall.sqlite");

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    initializeDatabase(db);
    globalForDb.aiHistoryRecallDb = db;
  }

  return globalForDb.aiHistoryRecallDb;
}

function initializeDatabase(db: Database.Database) {
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  migrateDatabase(db);
}

function migrateDatabase(db: Database.Database) {
  const columns = db
    .prepare("PRAGMA table_info(conversations)")
    .all() as { name: string }[];

  if (!columns.some((column) => column.name === "source_url")) {
    db.exec("ALTER TABLE conversations ADD COLUMN source_url TEXT");
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_source_url_unique
    ON conversations(source_platform, source_url)
    WHERE source_url IS NOT NULL
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_jobs (
      id TEXT PRIMARY KEY,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready', 'running', 'completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS capture_targets (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES capture_jobs(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, platform, url)
    );

    CREATE INDEX IF NOT EXISTS idx_capture_targets_job_status
    ON capture_targets(job_id, status);

    CREATE INDEX IF NOT EXISTS idx_capture_targets_platform
    ON capture_targets(platform);

    CREATE TABLE IF NOT EXISTS capture_discovery_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES capture_jobs(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      targets_found INTEGER NOT NULL,
      failures_count INTEGER NOT NULL,
      scanned_titles_count INTEGER NOT NULL,
      stop_reason TEXT,
      scrolls_performed INTEGER,
      max_items_reached INTEGER NOT NULL DEFAULT 0,
      max_scrolls_reached INTEGER NOT NULL DEFAULT 0,
      exhaustive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_capture_discovery_runs_platform_created
    ON capture_discovery_runs(platform, created_at);
  `);

  const discoveryColumns = db
    .prepare("PRAGMA table_info(capture_discovery_runs)")
    .all() as { name: string }[];
  if (!discoveryColumns.some((column) => column.name === "extension_version")) {
    db.exec("ALTER TABLE capture_discovery_runs ADD COLUMN extension_version TEXT");
  }
  if (!discoveryColumns.some((column) => column.name === "extension_build_id")) {
    db.exec("ALTER TABLE capture_discovery_runs ADD COLUMN extension_build_id TEXT");
  }
}

export function nowIso() {
  return new Date().toISOString();
}
