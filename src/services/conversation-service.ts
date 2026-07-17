import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import { getSimilarConversations } from "@/services/similarity-service";
import type {
  Conversation,
  ConversationInsight,
  ConversationWithMessages,
  Message
} from "@/types/conversation";

interface ConversationRow {
  id: string;
  source_platform: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  imported_at: string;
  summary: string | null;
  raw_file_name: string | null;
  source_url: string | null;
  note: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Message["role"];
  content: string;
  created_at: string | null;
  order_index: number;
}

function mapConversation(row: ConversationRow, tags: string[]): Conversation {
  return {
    id: row.id,
    sourcePlatform: row.source_platform,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    importedAt: row.imported_at,
    summary: row.summary,
    rawFileName: row.raw_file_name,
    sourceUrl: row.source_url,
    tags,
    manualTags: tags,
    autoTags: [],
    note: row.note ?? "",
    insight: null,
    similarConversations: []
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    orderIndex: row.order_index
  };
}

export function getConversation(id: string): ConversationWithMessages | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT c.*, n.content AS note
      FROM conversations c
      LEFT JOIN notes n ON n.conversation_id = c.id
      WHERE c.id = ?
    `
    )
    .get(id) as ConversationRow | undefined;

  if (!row) {
    return null;
  }

  const manualTags = db
    .prepare(
      `
      SELECT t.name
      FROM tags t
      JOIN conversation_tags ct ON ct.tag_id = t.id
      WHERE ct.conversation_id = ?
      ORDER BY t.name COLLATE NOCASE
    `
    )
    .all(id)
    .map((item) => (item as { name: string }).name);

  const autoTags = db
    .prepare(
      `
        SELECT tag
        FROM auto_conversation_tags
        WHERE conversation_id = ?
        ORDER BY tag COLLATE NOCASE
      `
    )
    .all(id)
    .map((item) => (item as { tag: string }).tag);

  const combinedTags = new Map<string, string>();
  for (const tag of [...manualTags, ...autoTags]) {
    const key = tag.toLocaleLowerCase();
    if (!combinedTags.has(key)) combinedTags.set(key, tag);
  }

  const insightRow = db
    .prepare(
      `
        SELECT summary, key_points_json, generator, generator_version, generated_at
        FROM conversation_insights
        WHERE conversation_id = ?
      `
    )
    .get(id) as {
      summary: string;
      key_points_json: string;
      generator: "rule" | "model";
      generator_version: string;
      generated_at: string;
    } | undefined;
  let insight: ConversationInsight | null = null;
  if (insightRow) {
    let keyPoints: string[] = [];
    try {
      const parsed = JSON.parse(insightRow.key_points_json) as unknown;
      if (Array.isArray(parsed)) keyPoints = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      keyPoints = [];
    }
    insight = {
      summary: insightRow.summary,
      keyPoints,
      generator: insightRow.generator,
      generatorVersion: insightRow.generator_version,
      generatedAt: insightRow.generated_at
    };
  }

  const messages = db
    .prepare(
      `
      SELECT *
      FROM messages
      WHERE conversation_id = ?
      ORDER BY order_index ASC
    `
    )
    .all(id)
    .map((item) => mapMessage(item as MessageRow));

  return {
    ...mapConversation(row, [...combinedTags.values()]),
    manualTags,
    autoTags,
    insight,
    similarConversations: getSimilarConversations(id),
    messages
  };
}

export function getDashboardStats() {
  const db = getDb();

  const conversationCount = (
    db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }
  ).count;

  const messageCount = (
    db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }
  ).count;

  const platformDistribution = db
    .prepare(
      `
      SELECT source_platform AS platform, COUNT(*) AS count
      FROM conversations
      GROUP BY source_platform
      ORDER BY count DESC, source_platform ASC
    `
    )
    .all() as { platform: string; count: number }[];

  const recentConversations = db
    .prepare(
      `
      SELECT c.*, COALESCE(n.content, '') AS note
      FROM conversations c
      LEFT JOIN notes n ON n.conversation_id = c.id
      ORDER BY datetime(c.imported_at) DESC
      LIMIT 8
    `
    )
    .all()
    .map((row) => mapConversation(row as ConversationRow, []));

  return {
    conversationCount,
    messageCount,
    platformDistribution,
    recentConversations
  };
}

export function updateConversationMetadata(
  conversationId: string,
  tags: string[],
  note: string
) {
  const db = getDb();
  const now = nowIso();

  const transaction = db.transaction(() => {
    const exists = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);

    if (!exists) {
      throw new Error("对话不存在");
    }

    db.prepare("DELETE FROM conversation_tags WHERE conversation_id = ?").run(
      conversationId
    );

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO tags (id, name, created_at)
      VALUES (@id, @name, @createdAt)
    `);
    const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
    const insertConversationTag = db.prepare(`
      INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id)
      VALUES (?, ?)
    `);

    const uniqueTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];

    for (const tag of uniqueTags) {
      insertTag.run({ id: randomUUID(), name: tag, createdAt: now });
      const row = getTag.get(tag) as { id: string } | undefined;
      if (row) {
        insertConversationTag.run(conversationId, row.id);
      }
    }

    const cleanNote = note.trim();
    if (cleanNote) {
      db.prepare(
        `
        INSERT INTO notes (id, conversation_id, content, created_at, updated_at)
        VALUES (@id, @conversationId, @content, @createdAt, @updatedAt)
        ON CONFLICT(conversation_id)
        DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
      `
      ).run({
        id: randomUUID(),
        conversationId,
        content: cleanNote,
        createdAt: now,
        updatedAt: now
      });
    } else {
      db.prepare("DELETE FROM notes WHERE conversation_id = ?").run(conversationId);
    }

    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
      now,
      conversationId
    );

    return {
      tags: uniqueTags,
      note: cleanNote
    };
  });

  return transaction();
}

export function deleteConversation(conversationId: string) {
  const db = getDb();

  const transaction = db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);

    if (!existing) {
      return { deleted: false };
    }

    db.prepare("DELETE FROM search_index WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM semantic_index WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM conversation_tags WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM notes WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);

    return { deleted: true };
  });

  return transaction();
}
