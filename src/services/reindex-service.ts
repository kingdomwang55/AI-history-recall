import { getDb } from "@/lib/db";
import { semanticIndexParams } from "@/services/semantic-index-service";
import type { MessageRole } from "@/types/conversation";

export function reindexSearch() {
  const db = getDb();

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM search_index").run();
    db.prepare("DELETE FROM semantic_index").run();

    const result = db
      .prepare(
        `
        INSERT INTO search_index (
          conversation_id,
          message_id,
          role,
          title,
          content,
          source_platform
        )
        SELECT
          c.id AS conversation_id,
          m.id AS message_id,
          m.role,
          c.title,
          m.content,
          c.source_platform
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        ORDER BY datetime(c.imported_at) DESC, m.order_index ASC
      `
      )
      .run();

    const insertSemanticIndex = db.prepare(`
      INSERT OR REPLACE INTO semantic_index (
        message_id, conversation_id, model, dimensions, content_hash, title,
        content, source_platform, role, imported_at, vector, updated_at
      )
      VALUES (
        @messageId, @conversationId, @model, @dimensions, @contentHash, @title,
        @content, @sourcePlatform, @role, @importedAt, @vector, @updatedAt
      )
    `);

    const semanticRows = db
      .prepare(
        `
        SELECT
          c.id AS conversationId,
          m.id AS messageId,
          m.role,
          c.title,
          m.content,
          c.source_platform AS sourcePlatform,
          c.imported_at AS importedAt
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        ORDER BY datetime(c.imported_at) DESC, m.order_index ASC
      `
      )
      .all() as Array<{
      conversationId: string;
      messageId: string;
      role: MessageRole;
      title: string;
      content: string;
      sourcePlatform: string;
      importedAt: string;
    }>;

    for (const row of semanticRows) {
      insertSemanticIndex.run(semanticIndexParams(row));
    }

    return {
      indexedMessages: result.changes,
      indexedSemanticMessages: semanticRows.length
    };
  });

  return transaction();
}
