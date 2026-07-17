import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type GlobalWithDb = typeof globalThis & {
  aiHistoryRecallDb?: Database.Database;
};

const globalForDb = globalThis as GlobalWithDb;

function ensurePrivatePath(filePath: string) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  }
}

function secureDatabaseFiles(dbPath: string) {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  }
}

export function getDb() {
  if (!globalForDb.aiHistoryRecallDb) {
    const dbPath =
      process.env.AIHR_DB_PATH ??
      path.join(process.cwd(), "data", "ai-history-recall.sqlite");

    ensurePrivatePath(dbPath);

    const db = new Database(dbPath);
    initializeDatabase(db);
    secureDatabaseFiles(dbPath);
    globalForDb.aiHistoryRecallDb = db;
  }

  return globalForDb.aiHistoryRecallDb;
}

export function closeDb() {
  if (!globalForDb.aiHistoryRecallDb) return;
  globalForDb.aiHistoryRecallDb.close();
  delete globalForDb.aiHistoryRecallDb;
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
      discovery_mode TEXT NOT NULL DEFAULT 'full' CHECK (discovery_mode IN ('full', 'incremental')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_capture_discovery_runs_platform_created
    ON capture_discovery_runs(platform, created_at);

    CREATE TABLE IF NOT EXISTS platform_sync_state (
      platform TEXT PRIMARY KEY,
      last_synced_at TEXT,
      last_discovered_at TEXT,
      last_seen_url TEXT,
      last_success_at TEXT,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error', 'paused')),
      last_new_conversations INTEGER NOT NULL DEFAULT 0,
      last_new_messages INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      backoff_until TEXT,
      background_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS semantic_index (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_platform TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'unknown')),
      imported_at TEXT NOT NULL,
      vector BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_index_conversation
    ON semantic_index(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_semantic_index_platform_model
    ON semantic_index(source_platform, model);

    CREATE TABLE IF NOT EXISTS health_check_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unavailable')),
      report_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_check_runs_generated
    ON health_check_runs(generated_at DESC);

    CREATE TABLE IF NOT EXISTS knowledge_jobs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL CHECK (task_type IN ('process')),
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      available_at TEXT NOT NULL,
      lease_until TEXT,
      last_error TEXT,
      completion_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(conversation_id, task_type, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_claim
    ON knowledge_jobs(status, available_at, lease_until, created_at);

    CREATE TABLE IF NOT EXISTS conversation_insights (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      summary TEXT NOT NULL,
      key_points_json TEXT NOT NULL DEFAULT '[]',
      generator TEXT NOT NULL CHECK (generator IN ('rule', 'model')),
      generator_version TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_conversation_tags (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      generator TEXT NOT NULL CHECK (generator IN ('rule', 'model')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_auto_conversation_tags_tag
    ON auto_conversation_tags(tag);

    CREATE TABLE IF NOT EXISTS conversation_vectors (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK (dimensions > 0),
      vector BLOB NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_vectors_model
    ON conversation_vectors(model, dimensions);

    CREATE TABLE IF NOT EXISTS conversation_similarities (
      left_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      right_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      fingerprint TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (left_conversation_id, right_conversation_id),
      CHECK (left_conversation_id < right_conversation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_similarities_right
    ON conversation_similarities(right_conversation_id, score DESC);
  `);

  if ((db.pragma("user_version", { simple: true }) as number) < 3) {
    db.pragma("user_version = 3");
  }

  const discoveryColumns = db
    .prepare("PRAGMA table_info(capture_discovery_runs)")
    .all() as { name: string }[];
  if (!discoveryColumns.some((column) => column.name === "extension_version")) {
    db.exec("ALTER TABLE capture_discovery_runs ADD COLUMN extension_version TEXT");
  }
  if (!discoveryColumns.some((column) => column.name === "extension_build_id")) {
    db.exec("ALTER TABLE capture_discovery_runs ADD COLUMN extension_build_id TEXT");
  }
  if (!discoveryColumns.some((column) => column.name === "discovery_mode")) {
    db.exec("ALTER TABLE capture_discovery_runs ADD COLUMN discovery_mode TEXT NOT NULL DEFAULT 'full'");
  }
}

export function nowIso() {
  return new Date().toISOString();
}
