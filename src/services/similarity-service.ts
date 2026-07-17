import { getDb, nowIso } from "@/lib/db";
import { knowledgeContentFingerprint } from "@/services/knowledge-queue-service";
import {
  createLocalConversationVector,
  decodeSemanticVector,
  encodeSemanticVector,
  semanticSimilarity
} from "@/services/semantic-index-service";
import type { MessageRole } from "@/types/conversation";

export interface SimilarConversation {
  conversationId: string;
  title: string;
  sourcePlatform: string;
  score: number;
  fingerprint: string;
}

type ConversationSource = {
  id: string;
  title: string;
  messages: Array<{ role: MessageRole; content: string }>;
};

type VectorRow = {
  conversation_id: string;
  fingerprint: string;
  model: string;
  dimensions: number;
  vector: Buffer;
  keywords_json: string;
  updated_at: string;
};

const stopWords = new Set([
  "the", "and", "for", "that", "with", "this", "from", "how", "what", "into", "then",
  "使用", "可以", "如何", "一个", "进行", "实现", "方案", "需要", "问题"
]);

function boundedContent(messages: ConversationSource["messages"]) {
  const selected: string[] = [];
  let length = 0;
  for (const message of messages) {
    if (length >= 8000) break;
    const content = message.content.replace(/\s+/g, " ").trim().slice(0, 1600);
    if (!content) continue;
    const part = `${message.role}: ${content}`.slice(0, 8000 - length);
    selected.push(part);
    length += part.length;
  }
  return selected.join("\n");
}

function keywords(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const terms = new Set<string>();
  for (const token of normalized.match(/[a-z][a-z0-9+#.-]{2,}|\p{Script=Han}+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(token)) {
      const chars = Array.from(token);
      for (let index = 0; index < chars.length - 1; index += 1) {
        const term = `${chars[index]}${chars[index + 1]}`;
        if (!stopWords.has(term)) terms.add(term);
      }
    } else if (!stopWords.has(token)) {
      terms.add(token);
    }
  }
  return [...terms].sort().slice(0, 160);
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function loadConversationSources() {
  const rows = getDb()
    .prepare(
      `
        SELECT c.id, c.title, m.role, m.content
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        ORDER BY c.id, m.order_index
      `
    )
    .all() as Array<{ id: string; title: string; role: MessageRole | null; content: string | null }>;
  const sources = new Map<string, ConversationSource>();
  for (const row of rows) {
    const source = sources.get(row.id) ?? { id: row.id, title: row.title, messages: [] };
    if (row.role && row.content) source.messages.push({ role: row.role, content: row.content });
    sources.set(row.id, source);
  }
  return [...sources.values()];
}

function ensureConversationVectors(conversationId: string, currentFingerprint: string) {
  const db = getDb();
  const existing = new Map(
    (db.prepare("SELECT * FROM conversation_vectors").all() as VectorRow[]).map((row) => [row.conversation_id, row])
  );
  const timestamp = nowIso();
  const upsert = db.prepare(
    `
      INSERT INTO conversation_vectors (
        conversation_id, fingerprint, model, dimensions, vector, keywords_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        model = excluded.model,
        dimensions = excluded.dimensions,
        vector = excluded.vector,
        keywords_json = excluded.keywords_json,
        updated_at = excluded.updated_at
    `
  );

  db.transaction(() => {
    for (const source of loadConversationSources()) {
      const fingerprint =
        source.id === conversationId
          ? currentFingerprint
          : knowledgeContentFingerprint({ title: source.title, messages: source.messages });
      if (existing.get(source.id)?.fingerprint === fingerprint) continue;
      const content = boundedContent(source.messages);
      const embedding = createLocalConversationVector(source.title, content);
      upsert.run(
        source.id,
        fingerprint,
        embedding.model,
        embedding.dimensions,
        encodeSemanticVector(embedding.vector),
        JSON.stringify(keywords(`${source.title}\n${content}`)),
        timestamp
      );
    }
  })();
}

function loadTags() {
  const rows = getDb()
    .prepare("SELECT conversation_id, tag FROM auto_conversation_tags")
    .all() as Array<{ conversation_id: string; tag: string }>;
  const tags = new Map<string, Set<string>>();
  for (const row of rows) {
    const values = tags.get(row.conversation_id) ?? new Set<string>();
    values.add(row.tag.toLocaleLowerCase());
    tags.set(row.conversation_id, values);
  }
  return tags;
}

export function replaceSimilarConversations(conversationId: string, fingerprint: string) {
  ensureConversationVectors(conversationId, fingerprint);
  const db = getDb();
  const vectors = db.prepare("SELECT * FROM conversation_vectors").all() as VectorRow[];
  const current = vectors.find((row) => row.conversation_id === conversationId);
  if (!current) throw new Error("Conversation vector is unavailable.");
  const currentVector = decodeSemanticVector(current.vector);
  const currentKeywords = new Set(JSON.parse(current.keywords_json) as string[]);
  const tags = loadTags();
  const currentTags = tags.get(conversationId) ?? new Set<string>();

  const ranked = vectors
    .filter(
      (candidate) =>
        candidate.conversation_id !== conversationId &&
        candidate.model === current.model &&
        candidate.dimensions === current.dimensions
    )
    .map((candidate) => {
      const cosine = Math.max(0, semanticSimilarity(currentVector, decodeSemanticVector(candidate.vector)));
      const tagScore = jaccard(currentTags, tags.get(candidate.conversation_id) ?? new Set<string>());
      const keywordScore = jaccard(
        currentKeywords,
        new Set(JSON.parse(candidate.keywords_json) as string[])
      );
      return {
        conversationId: candidate.conversation_id,
        score: Math.min(1, cosine * 0.7 + tagScore * 0.2 + keywordScore * 0.1)
      };
    })
    .filter((candidate) => candidate.score >= 0.28)
    .sort((left, right) => right.score - left.score || left.conversationId.localeCompare(right.conversationId))
    .slice(0, 8);

  const insert = db.prepare(
    `
      INSERT INTO conversation_similarities (
        left_conversation_id, right_conversation_id, score, fingerprint, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(left_conversation_id, right_conversation_id) DO UPDATE SET
        score = excluded.score, fingerprint = excluded.fingerprint, updated_at = excluded.updated_at
    `
  );
  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare(
      "DELETE FROM conversation_similarities WHERE left_conversation_id = ? OR right_conversation_id = ?"
    ).run(conversationId, conversationId);
    for (const candidate of ranked) {
      const [left, right] = [conversationId, candidate.conversationId].sort();
      insert.run(left, right, candidate.score, fingerprint, timestamp);
    }
  })();
  return ranked;
}

export function getSimilarConversations(conversationId: string, limit = 8): SimilarConversation[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 8;
  return getDb()
    .prepare(
      `
        SELECT
          CASE
            WHEN cs.left_conversation_id = @conversationId THEN cs.right_conversation_id
            ELSE cs.left_conversation_id
          END AS conversationId,
          c.title,
          c.source_platform AS sourcePlatform,
          cs.score,
          cs.fingerprint
        FROM conversation_similarities cs
        JOIN conversations c ON c.id = CASE
          WHEN cs.left_conversation_id = @conversationId THEN cs.right_conversation_id
          ELSE cs.left_conversation_id
        END
        WHERE cs.left_conversation_id = @conversationId OR cs.right_conversation_id = @conversationId
        ORDER BY cs.score DESC, c.title COLLATE NOCASE
        LIMIT @limit
      `
    )
    .all({ conversationId, limit: safeLimit }) as SimilarConversation[];
}
