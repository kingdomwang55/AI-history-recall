import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import { findAdapter } from "@/import/adapters";
import { semanticIndexParams } from "@/services/semantic-index-service";
import {
  enqueueKnowledgeJob,
  knowledgeContentFingerprint
} from "@/services/knowledge-queue-service";
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

function messageSignature(message: { role: MessageRole; content: string }) {
  return `${safeRole(message.role)}\u0000${message.content.replace(/\r\n/g, "\n").trim()}`;
}

function appendStartIndex(
  existing: Array<{ role: MessageRole; content: string }>,
  incoming: Array<{ role: MessageRole; content: string }>
) {
  const existingSignatures = existing.map(messageSignature);
  const incomingSignatures = incoming.map(messageSignature);

  if (incomingSignatures.length === 0) return 0;

  for (let start = 0; start <= existingSignatures.length - incomingSignatures.length; start += 1) {
    if (incomingSignatures.every((signature, index) => existingSignatures[start + index] === signature)) {
      return incomingSignatures.length;
    }
  }

  const maxOverlap = Math.min(existingSignatures.length, incomingSignatures.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingStart = existingSignatures.length - overlap;
    for (let incomingStart = 0; incomingStart <= incomingSignatures.length - overlap; incomingStart += 1) {
      const matches = incomingSignatures
        .slice(incomingStart, incomingStart + overlap)
        .every((signature, index) => existingSignatures[existingStart + index] === signature);
      if (matches) return incomingStart + overlap;
    }
  }

  // A snapshot without any stable overlap may be partial or from a changed extractor.
  // Avoid corrupting the canonical transcript by appending an unrelated sequence.
  return incomingSignatures.length;
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
    let importedConversations = 0;
    let importedMessages = 0;
    let updatedConversations = 0;
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
      SELECT id, title
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

    const getExistingMessages = db.prepare(`
      SELECT role, content
      FROM messages
      WHERE conversation_id = ?
      ORDER BY order_index
    `);

    const updateConversationAfterMerge = db.prepare(`
      UPDATE conversations
      SET updated_at = @updatedAt
      WHERE id = @conversationId
    `);

    const insertSearchIndex = db.prepare(`
      INSERT INTO search_index (
        conversation_id, message_id, role, title, content, source_platform
      )
      VALUES (
        @conversationId, @messageId, @role, @title, @content, @sourcePlatform
      )
    `);

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
        }) as { id: string; title: string } | undefined;

        if (existing) {
          const existingMessages = getExistingMessages.all(existing.id) as Array<{
            role: MessageRole;
            content: string;
          }>;
          const appendFrom = appendStartIndex(existingMessages, messages);
          const appendedMessages = messages.slice(appendFrom);

          if (appendedMessages.length === 0) {
            skippedDuplicates += 1;
            continue;
          }

          appendedMessages.forEach((message, index) => {
            const messageId = randomUUID();
            const role = safeRole(message.role);
            const orderIndex = existingMessages.length + index;

            insertMessage.run({
              id: messageId,
              conversationId: existing.id,
              role,
              content: message.content,
              createdAt: message.createdAt ?? conversation.createdAt ?? null,
              orderIndex
            });

            insertSearchIndex.run({
              conversationId: existing.id,
              messageId,
              role,
              title: existing.title,
              content: message.content,
              sourcePlatform
            });

            insertSemanticIndex.run(
              semanticIndexParams({
                conversationId: existing.id,
                messageId,
                role,
                title: existing.title,
                content: message.content,
                sourcePlatform,
                importedAt
              })
            );

            importedMessages += 1;
          });

          updateConversationAfterMerge.run({
            conversationId: existing.id,
            updatedAt:
              conversation.updatedAt ??
              appendedMessages.at(-1)?.createdAt ??
              importedAt
          });
          enqueueKnowledgeJob(
            existing.id,
            "process",
            knowledgeContentFingerprint({
              title: existing.title,
              messages: [...existingMessages, ...appendedMessages]
            }),
            importedAt
          );
          updatedConversations += 1;
          conversationIds.push(existing.id);
          continue;
        }
      }

      const title = conversation.title.trim() || rawFileName;
      insertConversation.run({
        id: conversationId,
        sourcePlatform,
        title,
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
          title,
          content: message.content,
          sourcePlatform
        });

        insertSemanticIndex.run(
          semanticIndexParams({
            conversationId,
            messageId,
            role,
            title,
            content: message.content,
            sourcePlatform,
            importedAt
          })
        );

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

      enqueueKnowledgeJob(
        conversationId,
        "process",
        knowledgeContentFingerprint({ title, messages }),
        importedAt
      );

      conversationIds.push(conversationId);
      importedConversations += 1;
    }

    return {
      importedConversations,
      importedMessages,
      updatedConversations,
      conversationIds,
      skippedDuplicates
    };
  });

  return transaction();
}
