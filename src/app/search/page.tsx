import Link from "next/link";
import { Search } from "lucide-react";
import { formatDateTime, roleLabel } from "@/lib/format";
import { PlatformBadge } from "@/components/PlatformBadge";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  getSearchFacets,
  searchConversations
} from "@/services/search-service";

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  platform?: string;
  tag?: string;
  sort?: string;
}

function markedSnippet(snippet: string) {
  const nodes: React.ReactNode[] = [];
  let rest = snippet;
  let index = 0;

  while (rest.includes(HIGHLIGHT_START)) {
    const start = rest.indexOf(HIGHLIGHT_START);
    const end = rest.indexOf(HIGHLIGHT_END, start + HIGHLIGHT_START.length);

    if (end === -1) {
      break;
    }

    if (start > 0) {
      nodes.push(<span key={`text-${index}`}>{rest.slice(0, start)}</span>);
      index += 1;
    }

    nodes.push(
      <mark key={`mark-${index}`}>
        {rest.slice(start + HIGHLIGHT_START.length, end)}
      </mark>
    );
    index += 1;
    rest = rest.slice(end + HIGHLIGHT_END.length);
  }

  if (rest) {
    nodes.push(<span key={`text-${index}`}>{rest}</span>);
  }

  return nodes;
}

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = {
    query: params.q ?? "",
    platform: params.platform || undefined,
    tag: params.tag || undefined,
    sort: params.sort === "oldest" ? ("oldest" as const) : ("newest" as const)
  };

  const facets = getSearchFacets();
  const results = searchConversations(filters);
  const backQuery = new URLSearchParams();
  if (filters.query) backQuery.set("q", filters.query);
  if (filters.platform) backQuery.set("platform", filters.platform);
  if (filters.tag) backQuery.set("tag", filters.tag);
  if (filters.sort) backQuery.set("sort", filters.sort);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">搜索历史对话</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          在所有已导入的 AI 对话里召回关键词、方案、代码和结论。
        </p>
      </div>

      <form
        action="/search"
        className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_180px_150px_auto] lg:items-end">
          <div className="grid gap-2">
            <label htmlFor="q" className="text-sm font-medium">
              关键词
            </label>
            <input
              id="q"
              name="q"
              defaultValue={filters.query}
              className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
              placeholder="例如 n8n、报错、产品方案"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="platform" className="text-sm font-medium">
              平台
            </label>
            <select
              id="platform"
              name="platform"
              defaultValue={filters.platform ?? ""}
              className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">全部平台</option>
              {facets.platforms.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value} ({item.count})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="tag" className="text-sm font-medium">
              标签
            </label>
            <select
              id="tag"
              name="tag"
              defaultValue={filters.tag ?? ""}
              className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">全部标签</option>
              {facets.tags.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value} ({item.count})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="sort" className="text-sm font-medium">
              排序
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={filters.sort}
              className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="newest">最近导入</option>
              <option value="oldest">最早导入</option>
            </select>
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] active:translate-y-px"
          >
            <Search size={16} strokeWidth={1.8} />
            <span>搜索</span>
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {filters.query ? `搜索结果 (${results.length})` : `最近对话 (${results.length})`}
          </h2>
        </div>

        {results.length === 0 ? (
          <div className="p-8 text-sm text-[var(--muted)]">
            没有找到匹配结果。可以换一个关键词，或先导入更多历史文件。
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {results.map((result) => (
              <Link
                key={`${result.conversationId}-${result.messageId ?? "conversation"}`}
                href={`/conversations/${result.conversationId}?from=${encodeURIComponent(backQuery.toString())}`}
                className="block px-5 py-5 transition hover:bg-[var(--surface-subtle)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformBadge platform={result.sourcePlatform} />
                  <span className="rounded-md bg-[var(--surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--muted)]">
                    {roleLabel(result.role)}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {formatDateTime(result.importedAt)}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold">{result.title}</h3>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                  {markedSnippet(result.snippet)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
