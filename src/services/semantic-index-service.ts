import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { MessageRole } from "@/types/conversation";

export const SEMANTIC_MODEL = "aihr-local-hash-v1";
export const SEMANTIC_DIMENSIONS = 192;

type EmbeddingProvider = "local" | "ollama" | "openai-compatible";

interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

interface SemanticIndexInput {
  conversationId: string;
  messageId: string;
  role: MessageRole;
  title: string;
  content: string;
  sourcePlatform: string;
  importedAt: string;
}

export interface SemanticCandidate {
  conversationId: string;
  messageId: string;
  title: string;
  sourcePlatform: string;
  role: MessageRole;
  importedAt: string;
  content: string;
  score: number;
}

interface SemanticSignals {
  tokens: Set<string>;
  concepts: Set<string>;
}

const conceptGroups = [
  ["search", "find", "lookup", "recall", "retrieve", "query", "检索", "搜索", "查找", "召回", "找回"],
  ["semantic", "embedding", "vector", "语义", "向量"],
  ["capture", "snapshot", "incremental", "quiet", "采集", "抓取", "快照", "增量", "静默"],
  ["extension", "browser", "chrome", "浏览器", "扩展"],
  ["sync", "synchronize", "background", "schedule", "同步", "后台", "计划"],
  ["desktop", "tray", "daemon", "idle", "resource", "cpu", "memory", "budget", "桌面", "托盘", "空闲", "资源", "占用", "内存", "预算"],
  ["import", "upload", "file", "adapter", "导入", "上传", "文件", "适配"],
  ["export", "download", "markdown", "json", "导出", "下载"],
  ["tag", "label", "note", "remark", "metadata", "标签", "备注", "笔记", "元数据"],
  ["delete", "remove", "cleanup", "reindex", "删除", "清理", "重建", "索引"],
  ["code", "snippet", "implementation", "bug", "fix", "debug", "代码", "实现", "问题", "修复", "调试"],
  ["privacy", "local", "security", "token", "隐私", "本地", "安全", "鉴权"],
  ["platform", "chatgpt", "gemini", "deepseek", "qwen", "claude", "平台", "通义", "千问"]
];

const conceptByTerm = new Map<string, string>();
conceptGroups.forEach((group, index) => {
  for (const term of group) {
    conceptByTerm.set(term, `concept:${index}`);
  }
});

export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = (process.env.AIHR_EMBEDDING_PROVIDER || "local").trim();
  const safeProvider: EmbeddingProvider =
    provider === "ollama" || provider === "openai-compatible" ? provider : "local";

  return {
    provider: safeProvider,
    model:
      process.env.AIHR_EMBEDDING_MODEL?.trim() ||
      (safeProvider === "ollama" ? "embeddinggemma" : SEMANTIC_MODEL),
    baseUrl:
      process.env.AIHR_EMBEDDING_BASE_URL?.trim() ||
      (safeProvider === "ollama" ? "http://127.0.0.1:11434" : ""),
    apiKey: process.env.AIHR_EMBEDDING_API_KEY?.trim() || "",
    timeoutMs: Math.min(
      Math.max(Number.parseInt(process.env.AIHR_EMBEDDING_TIMEOUT_MS || "20000", 10) || 20000, 1000),
      120000
    )
  };
}

function semanticModelKey(config = getEmbeddingConfig()) {
  return config.provider === "local" ? SEMANTIC_MODEL : `${config.provider}:${config.model}`;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashFeature(feature: string) {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addFeature(vector: Float32Array, feature: string, weight: number) {
  const hash = hashFeature(feature);
  const index = hash % SEMANTIC_DIMENSIONS;
  const sign = hash & 1 ? 1 : -1;
  vector[index] += sign * weight;
}

function rawTokens(text: string) {
  return text.match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) ?? [];
}

function semanticSignals(value: string): SemanticSignals {
  const text = normalizeText(value);
  const tokens = new Set<string>();
  const concepts = new Set<string>();

  for (const token of rawTokens(text)) {
    tokens.add(token);
    const concept = conceptByTerm.get(token);
    if (concept) concepts.add(concept);

    if (/^\p{Script=Han}+$/u.test(token)) {
      const chars = Array.from(token);
      for (const char of chars) {
        const charConcept = conceptByTerm.get(char);
        if (charConcept) concepts.add(charConcept);
      }
      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.add(`${chars[index]}${chars[index + 1]}`);
      }
      for (let index = 0; index < chars.length - 2; index += 1) {
        tokens.add(`${chars[index]}${chars[index + 1]}${chars[index + 2]}`);
      }
    }
  }

  for (const [term, concept] of conceptByTerm) {
    if (text.includes(term)) {
      concepts.add(concept);
    }
  }

  return { tokens, concepts };
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function lexicalSignal(query: SemanticSignals, document: SemanticSignals) {
  const conceptOverlap = intersectionSize(query.concepts, document.concepts);
  const tokenOverlap = intersectionSize(query.tokens, document.tokens);
  const requiredConceptOverlap = query.concepts.size >= 2 ? 2 : query.concepts.size;

  if (requiredConceptOverlap > 0 && conceptOverlap < requiredConceptOverlap) {
    return 0;
  }

  if (conceptOverlap === 0 && tokenOverlap === 0) {
    return 0;
  }

  const conceptScore = query.concepts.size
    ? conceptOverlap / Math.sqrt(query.concepts.size * Math.max(document.concepts.size, 1))
    : 0;
  const tokenScore = query.tokens.size
    ? tokenOverlap / Math.sqrt(query.tokens.size * Math.max(document.tokens.size, 1))
    : 0;

  return Math.min(1, conceptScore * 0.72 + tokenScore * 0.28);
}

function addTokenFeatures(vector: Float32Array, token: string, weight: number) {
  if (!token) return;

  addFeature(vector, `tok:${token}`, weight);

  const concept = conceptByTerm.get(token);
  if (concept) {
    addFeature(vector, concept, weight * 1.35);
  }

  if (/^\p{Script=Han}+$/u.test(token)) {
    const chars = Array.from(token);
    for (const char of chars) {
      addFeature(vector, `han1:${char}`, weight * 0.72);
      const charConcept = conceptByTerm.get(char);
      if (charConcept) addFeature(vector, charConcept, weight);
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      addFeature(vector, `han2:${chars[index]}${chars[index + 1]}`, weight * 1.15);
    }
    for (let index = 0; index < chars.length - 2; index += 1) {
      addFeature(vector, `han3:${chars[index]}${chars[index + 1]}${chars[index + 2]}`, weight);
    }
  } else if (token.length > 4) {
    for (let index = 0; index < token.length - 2; index += 1) {
      addFeature(vector, `tri:${token.slice(index, index + 3)}`, weight * 0.42);
    }
  }
}

function addTextFeatures(vector: Float32Array, value: string, weight: number) {
  const text = normalizeText(value);
  const tokens = rawTokens(text);

  tokens.forEach((token) => addTokenFeatures(vector, token, weight));

  for (let index = 0; index < tokens.length - 1; index += 1) {
    addFeature(vector, `pair:${tokens[index]} ${tokens[index + 1]}`, weight * 0.85);
  }

  for (const [term, concept] of conceptByTerm) {
    if (text.includes(term)) {
      addFeature(vector, concept, weight * 0.95);
    }
  }
}

function normalizeVector(vector: Float32Array) {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) {
    return vector;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= magnitude;
  }

  return vector;
}

export function semanticContentHash(title: string, content: string) {
  return createHash("sha256").update(`${title}\u0000${content}`).digest("hex");
}

export function createSemanticVector(title: string, content: string) {
  const vector = new Float32Array(SEMANTIC_DIMENSIONS);
  addTextFeatures(vector, title, 1.5);
  addTextFeatures(vector, content, 1);
  return normalizeVector(vector);
}

export function createLocalConversationVector(title: string, content: string) {
  const vector = createSemanticVector(title, content);
  return { model: SEMANTIC_MODEL, dimensions: vector.length, vector };
}

function vectorFromNumbers(values: number[]) {
  const vector = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    vector[index] = Number.isFinite(value) ? value : 0;
  }
  return normalizeVector(vector);
}

function runCurlJson(url: string, payload: unknown, config: EmbeddingConfig) {
  const args = [
    "-sS",
    "--max-time",
    String(Math.ceil(config.timeoutMs / 1000)),
    "-X",
    "POST",
    url,
    "-H",
    "Content-Type: application/json"
  ];

  if (config.apiKey) {
    args.push("-H", `Authorization: Bearer ${config.apiKey}`);
  }

  args.push("-d", JSON.stringify(payload));

  const output = execFileSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: config.timeoutMs + 1000
  });

  return JSON.parse(output) as unknown;
}

function createOllamaVector(text: string, config: EmbeddingConfig) {
  const response = runCurlJson(
    `${config.baseUrl.replace(/\/$/, "")}/api/embed`,
    { model: config.model, input: text },
    config
  ) as { embeddings?: number[][] };
  const vector = response.embeddings?.[0];

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Ollama embedding response did not include an embedding vector");
  }

  return vectorFromNumbers(vector);
}

function createOpenAiCompatibleVector(text: string, config: EmbeddingConfig) {
  const response = runCurlJson(
    `${config.baseUrl.replace(/\/$/, "")}/v1/embeddings`,
    { model: config.model, input: text },
    config
  ) as { data?: Array<{ embedding?: number[] }> };
  const vector = response.data?.[0]?.embedding;

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("OpenAI-compatible embedding response did not include an embedding vector");
  }

  return vectorFromNumbers(vector);
}

export function createConfiguredSemanticVector(title: string, content: string) {
  const config = getEmbeddingConfig();
  const text = `${title}\n${content}`.trim();

  if (config.provider === "ollama") {
    return {
      model: semanticModelKey(config),
      vector: createOllamaVector(text, config)
    };
  }

  if (config.provider === "openai-compatible") {
    if (!config.baseUrl) {
      throw new Error("AIHR_EMBEDDING_BASE_URL is required for openai-compatible embeddings");
    }

    return {
      model: semanticModelKey(config),
      vector: createOpenAiCompatibleVector(text, config)
    };
  }

  return {
    model: SEMANTIC_MODEL,
    vector: createSemanticVector(title, content)
  };
}

export function encodeSemanticVector(vector: Float32Array) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function decodeSemanticVector(value: Buffer) {
  return new Float32Array(value.buffer, value.byteOffset, value.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function semanticSimilarity(left: Float32Array, right: Float32Array) {
  let score = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export function semanticIndexParams(input: SemanticIndexInput) {
  const embedding = createConfiguredSemanticVector(input.title, input.content);
  const now = new Date().toISOString();

  return {
    conversationId: input.conversationId,
    messageId: input.messageId,
    model: embedding.model,
    dimensions: embedding.vector.length,
    contentHash: semanticContentHash(input.title, input.content),
    title: input.title,
    content: input.content,
    sourcePlatform: input.sourcePlatform,
    role: input.role,
    importedAt: input.importedAt,
    vector: encodeSemanticVector(embedding.vector),
    updatedAt: now
  };
}

export function searchSemanticIndex(
  db: Database.Database,
  filters: {
    query: string;
    platform?: string;
    tag?: string;
    dateFrom?: string;
    dateTo?: string;
  },
  options: { limit?: number; minScore?: number } = {}
): SemanticCandidate[] {
  let queryEmbedding: { model: string; vector: Float32Array };
  try {
    queryEmbedding = createConfiguredSemanticVector(filters.query, filters.query);
  } catch {
    queryEmbedding = {
      model: SEMANTIC_MODEL,
      vector: createSemanticVector(filters.query, filters.query)
    };
  }

  const querySignals = semanticSignals(filters.query);
  const limit = options.limit ?? 80;
  const minScore = options.minScore ?? 0.24;
  const where: string[] = ["si.model = @model", "si.dimensions = @dimensions"];
  const params: Record<string, string | number> = {
    model: queryEmbedding.model,
    dimensions: queryEmbedding.vector.length
  };

  if (filters.platform) {
    where.push("c.source_platform = @platform");
    params.platform = filters.platform;
  }

  if (filters.tag) {
    where.push(`
      (
        EXISTS (
          SELECT 1
          FROM conversation_tags ct
          JOIN tags t ON t.id = ct.tag_id
          WHERE ct.conversation_id = c.id AND t.name = @tag
        )
        OR EXISTS (
          SELECT 1
          FROM auto_conversation_tags act
          WHERE act.conversation_id = c.id AND act.tag = @tag
        )
      )
    `);
    params.tag = filters.tag;
  }

  if (filters.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) {
    where.push("date(c.imported_at, 'localtime') >= date(@dateFrom)");
    params.dateFrom = filters.dateFrom;
  }

  if (filters.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
    where.push("date(c.imported_at, 'localtime') <= date(@dateTo)");
    params.dateTo = filters.dateTo;
  }

  const rows = db
    .prepare(
      `
      SELECT
        si.conversation_id AS conversationId,
        si.message_id AS messageId,
        c.title,
        c.source_platform AS sourcePlatform,
        si.role,
        c.imported_at AS importedAt,
        si.content,
        si.vector
      FROM semantic_index si
      JOIN conversations c ON c.id = si.conversation_id
      WHERE ${where.join(" AND ")}
      ORDER BY datetime(c.imported_at) DESC
      LIMIT 3000
    `
    )
    .all(params) as Array<Omit<SemanticCandidate, "score"> & { vector: Buffer }>;

  return rows
    .map((row) => {
      const signal = lexicalSignal(querySignals, semanticSignals(`${row.title}\n${row.content}`));
      const vectorScore = semanticSimilarity(queryEmbedding.vector, decodeSemanticVector(row.vector));
      return {
        conversationId: row.conversationId,
        messageId: row.messageId,
        title: row.title,
        sourcePlatform: row.sourcePlatform,
        role: row.role,
        importedAt: row.importedAt,
        content: row.content,
        score: signal === 0 ? 0 : Math.max(vectorScore, 0) * 0.18 + signal * 0.82
      };
    })
    .filter((row) => row.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
