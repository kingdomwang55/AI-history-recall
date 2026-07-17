PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  imported_at TEXT NOT NULL,
  summary TEXT,
  raw_file_name TEXT,
  source_url TEXT,
  remark TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'unknown')),
  content TEXT NOT NULL,
  created_at TEXT,
  order_index INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_order
ON messages(conversation_id, order_index);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_tags (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag
ON conversation_tags(tag_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  role UNINDEXED,
  title,
  content,
  source_platform,
  tokenize = 'unicode61'
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

CREATE INDEX IF NOT EXISTS idx_conversations_imported_at
ON conversations(imported_at);

CREATE INDEX IF NOT EXISTS idx_conversations_source_platform
ON conversations(source_platform);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_source_url_unique
ON conversations(source_platform, source_url)
WHERE source_url IS NOT NULL;

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
  extension_version TEXT,
  extension_build_id TEXT,
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
