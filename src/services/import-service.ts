import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import { findAdapter } from "@/import/adapters";
import type {
  ImportFileInput,
  ImportResult,
  MessageRole,
  ParsedConversation
} from "@/types/conversation";

function uniqueTags(tags: string[] | undefined) {
  const normalized = new Set<string>();

  for (const tag of tags ?? []) {
    const value = tag.trim();
    if (value) {
      normalized.add(value);
    }
  }

  return [...normalized];
}

function safeRole(role: MessageRole) {
  if (["user", "assistant", "system", "unknown"].includes(role)) {
    return role;
  }

  return "unknown";
}

export async function importFile(input: ImportFileInput): Promise<ImportResult> {
  const adapter = findAdapter(input);

  if (!adapter) {
    return {
      ok: false,
      fileName: input.fileName,
      adapter: null,
      importedConversations: 0,
      importedMessages: 0,
      conversationIds: [],
      errors: ["暂不支持这个文件格式"]
    };
  }

  try {
    const parsed = await adapter.parse(input);

    if (parsed.length === 0) {
      return {
        ok: false,
        fileName: input.fileName,
        adapter: adapter.displayName,
        importedConversations: 0,
        importedMessages: 0,
        conversationIds: [],
        errors: ["文件已识别，但没有解析出有效消息"]
      };
    }

    const result = persistConversations(parsed, input.fileName, adapter.id);

    return {
      ok: true,
      fileName: input.fileName,
      adapter: adapter.displayName,
      ...result,
      errors: []
    };
  } catch (error) {
    return {
      ok: false,
      fileName: input.fileName,
      adapter: adapter.displayName,
      importedConversations: 0,
      importedMessages: 0,
      conversationIds: [],
      errors: [error instanceof Error ? error.message : "导入失败"]
    };
  }
}

export function importParsedConversations(
  conversations: ParsedConversation[],
  rawFileName: string,
  adapterId: string
) {
  return persistConversations(conversations, rawFileName, adapterId);
}

function persistConversations(
  conversations: ParsedConversation[],
  rawFileName: string,
  adapterId: string
) {
  const db = getDb();
  const importedAt = nowIso();

  const transaction = db.transaction(() => {
    const conversationIds: string[] = [];
    let importedMessages = 0;
    let skippedDuplicates = 0;

    const insertConversation = db.prepare(`
      INSERT INTO conversations (
        id, source_platform, title, created_at, updated_at, imported_at,
        summary, raw_file_name, source_url, remark
      )
      VALUES (
        @id, @sourcePlatform, @title, @createdAt, @updatedAt, @importedAt,
        @summary, @rawFileName, @sourceUrl, NULL
      )
    `);

    const findExistingConversation = db.prepare(`
      SELECT id
      FROM conversations
      WHERE source_platform = @sourcePlatform
        AND source_url = @sourceUrl
      LIMIT 1
    `);

    const insertMessage = db.prepare(`
      INSERT INTO messages (
        id, conversation_id, role, content, created_at, order_index
      )
      VALUES (
        @id, @conversationId, @role, @content, @createdAt, @orderIndex
      )
    `);

    const insertSearchIndex = db.prepare(`
      INSERT INTO search_index (
        conversation_id, message_id, role, title, content, source_platform
      )
      VALUES (
        @conversationId, @messageId, @role, @title, @content, @sourcePlatform
      )
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO tags (id, name, created_at)
      VALUES (@id, @name, @createdAt)
    `);

    const getTag = db.prepare(`
      SELECT id FROM tags WHERE name = ?
    `);

    const insertConversationTag = db.prepare(`
      INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id)
      VALUES (?, ?)
    `);

    for (const conversation of conversations) {
      const messages = conversation.messages
        .map((message) => ({
          ...message,
          content: message.content.trim()
        }))
        .filter((message) => message.content.length > 0);

      if (messages.length === 0) {
        continue;
      }

      const conversationId = randomUUID();
      const sourcePlatform = conversation.sourcePlatform || adapterId;
      const sourceUrl = conversation.sourceUrl ?? null;

      if (sourceUrl) {
        const existing = findExistingConversation.get({
          sourcePlatform,
          sourceUrl
        });

        if (existing) {
          skippedDuplicates += 1;
          continue;
        }
      }

      insertConversation.run({
        id: conversationId,
        sourcePlatform,
        title: conversation.title.trim() || rawFileName,
        createdAt: conversation.createdAt ?? null,
        updatedAt: conversation.updatedAt ?? null,
        importedAt,
        summary: conversation.summary ?? null,
        rawFileName,
        sourceUrl
      });

      messages.forEach((message, index) => {
        const messageId = randomUUID();
        const role = safeRole(message.role);

        insertMessage.run({
          id: messageId,
          conversationId,
          role,
          content: message.content,
          createdAt: message.createdAt ?? conversation.createdAt ?? null,
          orderIndex: index
        });

        insertSearchIndex.run({
          conversationId,
          messageId,
          role,
          title: conversation.title,
          content: message.content,
          sourcePlatform
        });

        importedMessages += 1;
      });

      for (const tag of uniqueTags(conversation.tags)) {
        const tagId = randomUUID();
        insertTag.run({ id: tagId, name: tag, createdAt: importedAt });
        const row = getTag.get(tag) as { id: string } | undefined;
        if (row) {
          insertConversationTag.run(conversationId, row.id);
        }
      }

      conversationIds.push(conversationId);
    }

    return {
      importedConversations: conversationIds.length,
      importedMessages,
      conversationIds,
      skippedDuplicates
    };
  });

  return transaction();
}
