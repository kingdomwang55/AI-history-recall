import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { formatDateTime, roleLabel } from "@/lib/format";
import { PlatformBadge } from "@/components/PlatformBadge";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  getSearchCorpusStats,
  getSearchFacets,
  searchConversations
} from "@/services/search-service";

export const dynamic = "force-dynamic";

interface SearchParams { q?: string; platform?: string; tag?: string; dateFrom?: string; dateTo?: string; sort?: string; }

type SearchFilters = {
  query: string;
  platform?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: "newest" | "oldest";
};

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function SearchFilterForm({
  filters,
  facets,
  idPrefix
}: {
  filters: SearchFilters;
  facets: ReturnType<typeof getSearchFacets>;
  idPrefix: string;
}) {
  const fieldId = (name: string) => `${idPrefix}-${name}`;

  return (
    <form action="/search" className="search-filter-body">
      <div className="mb-5"><div className="text-sm font-semibold">搜索与筛选</div><div className="mt-1 text-xs text-[var(--muted)]">缩小范围，快速找到需要的上下文。</div></div>
      <label htmlFor={fieldId("q")} className="mb-1.5 block text-xs font-medium text-[var(--muted-strong)]">关键词</label>
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={15} /><input id={fieldId("q")} name="q" defaultValue={filters.query} className="control search-control w-full" placeholder="搜索内容" /></div>
      <label htmlFor={fieldId("platform")} className="mb-1.5 mt-5 block text-xs font-medium text-[var(--muted-strong)]">平台</label>
      <select id={fieldId("platform")} name="platform" defaultValue={filters.platform ?? ""} className="control w-full"><option value="">全部平台</option>{facets.platforms.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select>
      <label htmlFor={fieldId("tag")} className="mb-1.5 mt-5 block text-xs font-medium text-[var(--muted-strong)]">标签</label>
      <select id={fieldId("tag")} name="tag" defaultValue={filters.tag ?? ""} className="control w-full"><option value="">全部标签</option>{facets.tags.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select>
      <div className="mb-1.5 mt-5 text-xs font-medium text-[var(--muted-strong)]">导入日期</div>
      <div className="date-range-grid">
        <label htmlFor={fieldId("dateFrom")}><span>开始</span><input id={fieldId("dateFrom")} name="dateFrom" type="date" defaultValue={filters.dateFrom ?? ""} className="control w-full" /></label>
        <label htmlFor={fieldId("dateTo")}><span>结束</span><input id={fieldId("dateTo")} name="dateTo" type="date" defaultValue={filters.dateTo ?? ""} className="control w-full" /></label>
      </div>
      <label htmlFor={fieldId("sort")} className="mb-1.5 mt-5 block text-xs font-medium text-[var(--muted-strong)]">排序</label>
      <select id={fieldId("sort")} name="sort" defaultValue={filters.sort} className="control w-full"><option value="newest">导入时间（新到旧）</option><option value="oldest">导入时间（旧到新）</option></select>
      <button type="submit" className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[7px] bg-[var(--accent)] px-4 font-semibold text-white hover:bg-[var(--accent-strong)]"><Search size={16} />搜索</button>
    </form>
  );
}

function markedSnippet(snippet: string) {
  const nodes: React.ReactNode[] = [];
  let rest = snippet;
  let index = 0;
  while (rest.includes(HIGHLIGHT_START)) {
    const start = rest.indexOf(HIGHLIGHT_START);
    const end = rest.indexOf(HIGHLIGHT_END, start + HIGHLIGHT_START.length);
    if (end === -1) break;
    if (start > 0) nodes.push(<span key={`text-${index++}`}>{rest.slice(0, start)}</span>);
    nodes.push(<mark key={`mark-${index++}`}>{rest.slice(start + HIGHLIGHT_START.length, end)}</mark>);
    rest = rest.slice(end + HIGHLIGHT_END.length);
  }
  if (rest) nodes.push(<span key={`text-${index}`}>{rest}</span>);
  return nodes;
}

function matchKindLabel(kind: string | undefined) {
  if (kind === "hybrid") return "双命中";
  if (kind === "semantic") return "语义";
  if (kind === "keyword") return "关键词";
  return "最近";
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters: SearchFilters = {
    query: params.q ?? "",
    platform: params.platform || undefined,
    tag: params.tag || undefined,
    dateFrom: validDate(params.dateFrom),
    dateTo: validDate(params.dateTo),
    sort: params.sort === "oldest" ? "oldest" : "newest"
  };
  const facets = getSearchFacets();
  const corpus = getSearchCorpusStats();
  const results = searchConversations(filters);
  const backQuery = new URLSearchParams();
  if (filters.query) backQuery.set("q", filters.query);
  if (filters.platform) backQuery.set("platform", filters.platform);
  if (filters.tag) backQuery.set("tag", filters.tag);
  if (filters.dateFrom) backQuery.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) backQuery.set("dateTo", filters.dateTo);
  backQuery.set("sort", filters.sort);

  return (
    <div>
      <header className="page-header">
        <div><h1 className="page-title">搜索历史对话</h1><p className="page-description">在所有已导入的 AI 对话里召回关键词、方案、代码和结论。</p></div>
      </header>

      <div className="knowledge-workspace">
        <aside className="search-filter-panel">
          <div className="search-filter-desktop">
            <SearchFilterForm filters={filters} facets={facets} idPrefix="desktop" />
          </div>
          <details className="search-filter-mobile">
            <summary><span className="inline-flex items-center gap-2"><SlidersHorizontal size={16} />筛选条件</span><ChevronDown size={15} /></summary>
            <SearchFilterForm filters={filters} facets={facets} idPrefix="mobile" />
          </details>
        </aside>

        <section className="search-result-list">
          <div className="panel-header bg-[var(--surface)]"><div><h2 className="panel-title">{filters.query ? "搜索结果" : "最近对话"}</h2><div className="mt-0.5 text-xs text-[var(--muted)]">共 {results.length} 条结果</div></div></div>
          {results.length === 0 ? (
            <div className="p-10 text-sm text-[var(--muted)]">
              {corpus.conversations === 0
                ? "当前数据目录还没有对话。请先导入历史文件，或在设置中恢复已有备份。"
                : "没有找到匹配结果。可以换一个关键词，或清空部分筛选条件。"}
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {results.map((result) => (
                <Link key={`${result.conversationId}-${result.messageId ?? "conversation"}`} href={`/conversations/${result.conversationId}?from=${encodeURIComponent(backQuery.toString())}`} className="group grid gap-2 px-5 py-4 transition hover:bg-[var(--surface-subtle)] sm:grid-cols-[minmax(0,1fr)_150px]">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={result.sourcePlatform} /><span className="text-[11px] text-[var(--muted)]">{roleLabel(result.role)}</span><span className="match-kind-badge">{matchKindLabel(result.matchKind)}</span></div><h3 className="mt-2 truncate text-[15px] font-semibold group-hover:text-[var(--accent-strong)]">{result.title}</h3><p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[13px] leading-5 text-[var(--muted)]">{markedSnippet(result.snippet)}</p></div>
                  <div className="text-xs tabular-nums text-[var(--muted)] sm:text-right">{formatDateTime(result.importedAt)}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
