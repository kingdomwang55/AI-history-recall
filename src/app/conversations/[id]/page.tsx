import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ConversationExportButtons } from "@/components/ConversationExportButtons";
import { ConversationManagementPanel } from "@/components/ConversationManagementPanel";
import { CopyButton } from "@/components/CopyButton";
import { MessageList } from "@/components/MessageList";
import { MetadataEditor } from "@/components/MetadataEditor";
import { PlatformBadge } from "@/components/PlatformBadge";
import { buildConversationText, formatDateTime, roleLabel } from "@/lib/format";
import { getConversation } from "@/services/conversation-service";
import { HIGHLIGHT_END, HIGHLIGHT_START, searchConversations } from "@/services/search-service";

export const dynamic = "force-dynamic";

function cleanContextSnippet(value: string) {
  return value.replaceAll(HIGHLIGHT_START, "").replaceAll(HIGHLIGHT_END, "");
}

function matchKindLabel(kind: string | undefined) {
  if (kind === "hybrid") return "双命中";
  if (kind === "semantic") return "语义";
  if (kind === "keyword") return "关键词";
  return "最近";
}

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const conversation = getConversation(id);
  if (!conversation) notFound();
  const backHref = from ? `/search?${from}` : "/search";
  const contextParams = new URLSearchParams(from ?? "sort=newest");
  const contextResults = searchConversations({
    query: contextParams.get("q") ?? "",
    platform: contextParams.get("platform") || undefined,
    tag: contextParams.get("tag") || undefined,
    dateFrom: contextParams.get("dateFrom") || undefined,
    dateTo: contextParams.get("dateTo") || undefined,
    sort: contextParams.get("sort") === "oldest" ? "oldest" : "newest"
  });
  const contextConversations = Array.from(
    new Map(contextResults.map((result) => [result.conversationId, result])).values()
  ).slice(0, 20);
  const contextQuery = from ?? "sort=newest";

  return (
    <div>
      <Link href={backHref} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-strong)]"><ArrowLeft size={16} />返回搜索结果</Link>
      <section className="conversation-workspace">
        <aside className="conversation-context-list">
          <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--bg-tertiary)] px-4 py-3">
            <div className="text-sm font-semibold">搜索结果</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{contextConversations.length} 条相关对话</div>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {contextConversations.map((result) => (
              <Link
                key={result.conversationId}
                href={`/conversations/${result.conversationId}?from=${encodeURIComponent(contextQuery)}`}
                data-active={result.conversationId === conversation.id ? "true" : undefined}
                className="block border-l-2 border-transparent px-4 py-3 hover:bg-[var(--surface-subtle)] data-[active=true]:border-[var(--accent)] data-[active=true]:bg-[var(--accent-soft)]"
              >
                <div className="flex items-center gap-2"><PlatformBadge platform={result.sourcePlatform} /><span className="text-[11px] text-[var(--muted)]">{roleLabel(result.role)}</span><span className="match-kind-badge">{matchKindLabel(result.matchKind)}</span></div>
                <div className="mt-2 line-clamp-1 text-sm font-semibold">{result.title}</div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{cleanContextSnippet(result.snippet)}</div>
                <div className="mt-2 text-[11px] tabular-nums text-[var(--muted)]">{formatDateTime(result.importedAt)}</div>
              </Link>
            ))}
          </div>
        </aside>
        <div className="conversation-transcript">
          <header className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={conversation.sourcePlatform} /><span className="text-xs text-[var(--muted)]">导入于 {formatDateTime(conversation.importedAt)}</span></div>
            <div className="mt-3">
              <div className="min-w-0"><h1 className="break-words text-[26px] font-semibold leading-tight">{conversation.title}</h1>{conversation.rawFileName ? <p className="mt-2 truncate text-xs text-[var(--muted)]" title={conversation.rawFileName}>原始文件：{conversation.rawFileName}</p> : null}</div>
              <div className="mt-4 flex flex-wrap items-center gap-2"><CopyButton text={buildConversationText(conversation.title, conversation.messages)} label="复制整段对话" /><ConversationExportButtons conversationId={conversation.id} title={conversation.title} /></div>
            </div>
            {conversation.tags.length ? <div className="mt-4 flex flex-wrap gap-2">{conversation.tags.map((tag) => <span key={tag} className="rounded-[4px] bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--muted-strong)]">{tag}</span>)}</div> : null}
          </header>
          <div className="p-4 sm:p-5"><MessageList messages={conversation.messages} /></div>
        </div>

        <aside className="conversation-inspector">
          <MetadataEditor conversationId={conversation.id} initialTags={conversation.tags} initialNote={conversation.note} />
          <div className="border-t border-[var(--line)] p-5 text-sm">
            <h2 className="font-semibold">对话信息</h2>
            <dl className="mt-4 grid gap-3 text-xs"><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">消息数</dt><dd>{conversation.messages.length}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">创建时间</dt><dd className="text-right">{formatDateTime(conversation.createdAt)}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">更新时间</dt><dd className="text-right">{formatDateTime(conversation.updatedAt)}</dd></div></dl>
          </div>
          <ConversationManagementPanel conversationId={conversation.id} />
        </aside>
      </section>
    </div>
  );
}
