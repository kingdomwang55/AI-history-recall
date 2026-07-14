import { getDb } from "@/lib/db";
import type { MessageRole } from "@/types/conversation";

export const HIGHLIGHT_START = "[[AIHR_HIGHLIGHT_START]]";
export const HIGHLIGHT_END = "[[AIHR_HIGHLIGHT_END]]";

export interface SearchFilters {
  query: string;
  platform?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: "newest" | "oldest";
}

export interface SearchResult {
  conversationId: string;
  messageId: string | null;
  title: string;
  sourcePlatform: string;
  role: MessageRole;
  importedAt: string;
  snippet: string;
}

export function getSearchFacets() {
  const db = getDb();

  const platforms = db
    .prepare(
      `
      SELECT source_platform AS value, COUNT(*) AS count
      FROM conversations
      GROUP BY source_platform
      ORDER BY count DESC, source_platform ASC
    `
    )
    .all() as { value: string; count: number }[];

  const tags = db
    .prepare(
      `
      SELECT t.name AS value, COUNT(ct.conversation_id) AS count
      FROM tags t
      JOIN conversation_tags ct ON ct.tag_id = t.id
      GROUP BY t.id
      ORDER BY count DESC, t.name COLLATE NOCASE
    `
    )
    .all() as { value: string; count: number }[];

  return { platforms, tags };
}

function ftsQuery(value: string) {
  const terms = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return terms
    .map((term) => `"${term.replaceAll("\"", "\"\"")}"`)
    .join(" AND ");
}

function buildWhere(filters: SearchFilters, useFts: boolean) {
  const where: string[] = [];
  const params: Record<string, string> = {};

  if (useFts) {
    where.push("search_index MATCH @match");
    params.match = ftsQuery(filters.query);
  } else if (filters.query.trim()) {
    where.push("(m.content LIKE @like OR c.title LIKE @like)");
    params.like = `%${filters.query.trim()}%`;
  }

  if (filters.platform) {
    where.push("c.source_platform = @platform");
    params.platform = filters.platform;
  }

  if (filters.tag) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM conversation_tags ct
        JOIN tags t ON t.id = ct.tag_id
        WHERE ct.conversation_id = c.id AND t.name = @tag
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

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params
  };
}

function sortSql(sort: SearchFilters["sort"]) {
  return sort === "oldest" ? "ASC" : "DESC";
}

function plainSnippet(title: string, content: string, query: string) {
  const source = `${title}\n${content}`.replace(/\s+/g, " ").trim();
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const term = terms[0] ?? "";

  if (!term) {
    return source.slice(0, 240);
  }

  const index = source.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) {
    return source.slice(0, 240);
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(source.length, index + term.length + 140);
  const before = source.slice(start, index);
  const match = source.slice(index, index + term.length);
  const after = source.slice(index + term.length, end);

  return `${start > 0 ? "..." : ""}${before}${HIGHLIGHT_START}${match}${HIGHLIGHT_END}${after}${end < source.length ? "..." : ""}`;
}

function recentResults(filters: SearchFilters): SearchResult[] {
  const db = getDb();
  const { sql, params } = buildWhere({ ...filters, query: "" }, false);

  return db
    .prepare(
      `
      SELECT
        c.id AS conversationId,
        m.id AS messageId,
        c.title,
        c.source_platform AS sourcePlatform,
        COALESCE(m.role, 'unknown') AS role,
        c.imported_at AS importedAt,
        COALESCE(m.content, '') AS content
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
        AND m.order_index = (
          SELECT MIN(order_index)
          FROM messages
          WHERE conversation_id = c.id
        )
      ${sql}
      ORDER BY datetime(c.imported_at) ${sortSql(filters.sort)}
      LIMIT 80
    `
    )
    .all(params)
    .map((row) => {
      const item = row as {
        conversationId: string;
        messageId: string | null;
        title: string;
        sourcePlatform: string;
        role: MessageRole;
        importedAt: string;
        content: string;
      };

      return {
        ...item,
        snippet: plainSnippet(item.title, item.content, "")
      };
    });
}

export function searchConversations(filters: SearchFilters): SearchResult[] {
  const db = getDb();
  const query = filters.query.trim();

  if (!query) {
    return recentResults(filters);
  }

  const match = ftsQuery(query);
  if (!match) {
    return recentResults({ ...filters, query: "" });
  }

  const { sql, params } = buildWhere(filters, true);

  try {
    return db
      .prepare(
        `
        SELECT
          search_index.conversation_id AS conversationId,
          search_index.message_id AS messageId,
          c.title,
          c.source_platform AS sourcePlatform,
          search_index.role AS role,
          c.imported_at AS importedAt,
          snippet(search_index, -1, '${HIGHLIGHT_START}', '${HIGHLIGHT_END}', '...', 28) AS snippet
        FROM search_index
        JOIN conversations c ON c.id = search_index.conversation_id
        ${sql}
        ORDER BY datetime(c.imported_at) ${sortSql(filters.sort)}
        LIMIT 100
      `
      )
      .all(params) as SearchResult[];
  } catch {
    const fallback = buildWhere(filters, false);
    return db
      .prepare(
        `
        SELECT
          c.id AS conversationId,
          m.id AS messageId,
          c.title,
          c.source_platform AS sourcePlatform,
          m.role AS role,
          c.imported_at AS importedAt,
          m.content AS content
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        ${fallback.sql}
        ORDER BY datetime(c.imported_at) ${sortSql(filters.sort)}
        LIMIT 100
      `
      )
      .all(fallback.params)
      .map((row) => {
        const item = row as SearchResult & { content: string };
        return {
          conversationId: item.conversationId,
          messageId: item.messageId,
          title: item.title,
          sourcePlatform: item.sourcePlatform,
          role: item.role,
          importedAt: item.importedAt,
          snippet: plainSnippet(item.title, item.content, query)
        };
      });
  }
}
