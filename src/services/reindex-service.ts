import { getDb } from "@/lib/db";

export function reindexSearch() {
  const db = getDb();

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM search_index").run();

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

    return {
      indexedMessages: result.changes
    };
  });

  return transaction();
}
