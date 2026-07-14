import Link from "next/link";
import { ArrowRight, Bot, Database, MessageSquareText, Search, Upload } from "lucide-react";
import { formatDateTime, platformLabel } from "@/lib/format";
import { getDashboardStats } from "@/services/conversation-service";
import { PlatformBadge } from "@/components/PlatformBadge";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const stats = getDashboardStats();

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-normal sm:text-5xl">
            把散落在各个平台的 AI 历史对话重新召回
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
            AI 工具越用越多，真正的问题不是模型不够强，而是人的问题资产正在失忆。
            AI History Recall 帮你把曾经解决过的问题、方案和代码沉淀回本地。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] active:translate-y-px"
            >
              <Search size={16} strokeWidth={1.8} />
              <span>搜索历史</span>
            </Link>
            <Link
              href="/import"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface-subtle)] active:translate-y-px"
            >
              <Upload size={16} strokeWidth={1.8} />
              <span>导入文件</span>
            </Link>
            <Link
              href="/capture"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--surface-subtle)] active:translate-y-px"
            >
              <Bot size={16} strokeWidth={1.8} />
              <span>浏览器采集</span>
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="text-sm font-medium text-[var(--muted)]">本地数据概览</div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--surface-subtle)] p-4">
              <Database size={18} strokeWidth={1.8} className="text-[var(--accent)]" />
              <div className="mt-3 text-3xl font-semibold">{stats.conversationCount}</div>
              <div className="text-xs text-[var(--muted)]">已导入对话</div>
            </div>
            <div className="rounded-lg bg-[var(--surface-subtle)] p-4">
              <MessageSquareText
                size={18}
                strokeWidth={1.8}
                className="text-[var(--accent)]"
              />
              <div className="mt-3 text-3xl font-semibold">{stats.messageCount}</div>
              <div className="text-xs text-[var(--muted)]">已索引消息</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="text-lg font-semibold">来源平台分布</h2>
          {stats.platformDistribution.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
              还没有导入数据。
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {stats.platformDistribution.map((item) => (
                <div key={item.platform} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{platformLabel(item.platform)}</span>
                  <span className="rounded-md bg-[var(--surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--muted)]">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">最近导入</h2>
            <Link
              href="/search"
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-strong)]"
            >
              <span>查看全部</span>
              <ArrowRight size={15} strokeWidth={1.8} />
            </Link>
          </div>

          {stats.recentConversations.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
              从导入页添加第一个 TXT、Markdown 或 JSON 文件。
            </div>
          ) : (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {stats.recentConversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/conversations/${conversation.id}`}
                  className="block py-4 transition hover:bg-[var(--surface-subtle)] sm:-mx-3 sm:px-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={conversation.sourcePlatform} />
                    <span className="text-xs text-[var(--muted)]">
                      {formatDateTime(conversation.importedAt)}
                    </span>
                  </div>
                  <div className="mt-2 font-medium">{conversation.title}</div>
                  {conversation.rawFileName ? (
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {conversation.rawFileName}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
