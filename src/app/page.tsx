import Link from "next/link";
import { Activity, ArrowRight, Bot, Database, MessageSquareText, Search, Upload } from "lucide-react";
import { formatDateTime, platformLabel } from "@/lib/format";
import { getDashboardStats } from "@/services/conversation-service";
import { PlatformBadge } from "@/components/PlatformBadge";
import { getHealthReport } from "@/services/health-check-service";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const stats = getDashboardStats();
  const health = getHealthReport();
  const healthCopy = health.status === "healthy" ? "运行正常" : health.status === "degraded" ? "需要关注" : "服务不可用";
  const healthDot = health.status === "healthy" ? "status-dot-success" : health.status === "degraded" ? "status-dot-warning" : "status-dot-danger";
  const maxPlatformCount = Math.max(...stats.platformDistribution.map((item) => item.count), 1);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">检索中枢</h1>
          <p className="page-description">
            召回散落在不同 AI 平台里的问题、方案和代码。所有数据仅保存在本机 SQLite。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/import" className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium hover:bg-[var(--surface-subtle)]">
            <Upload size={15} strokeWidth={1.8} />导入文件
          </Link>
          <Link href="/capture" className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium hover:bg-[var(--surface-subtle)]">
            <Bot size={15} strokeWidth={1.8} />浏览器采集
          </Link>
        </div>
      </header>

      <section className="panel overflow-hidden">
        <div className="grid divide-y divide-[var(--line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="flex items-center gap-4 px-5 py-4">
            <Database size={19} className="text-[var(--accent)]" strokeWidth={1.8} />
            <div><div className="text-2xl font-semibold tabular-nums">{stats.conversationCount}</div><div className="text-xs text-[var(--muted)]">已导入对话</div></div>
          </div>
          <div className="flex items-center gap-4 px-5 py-4">
            <MessageSquareText size={19} className="text-[var(--accent)]" strokeWidth={1.8} />
            <div><div className="text-2xl font-semibold tabular-nums">{stats.messageCount}</div><div className="text-xs text-[var(--muted)]">已索引消息</div></div>
          </div>
          <Link href="/health" className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-subtle)]">
            <Activity size={19} className="text-[var(--accent)]" strokeWidth={1.8} />
            <span className={`status-dot ${healthDot}`} />
            <div className="min-w-0"><div className="font-semibold">{healthCopy}</div><div className="truncate text-xs text-[var(--muted)]">查看本地服务诊断</div></div>
          </Link>
        </div>
      </section>

      <Link href="/search" className="mt-4 flex min-h-14 items-center gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 text-[var(--foreground)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-tertiary)]">
        <Search size={19} strokeWidth={1.8} />
        <div className="min-w-0 flex-1"><div className="font-semibold">搜索历史对话</div><div className="truncate text-xs text-[var(--muted)]">输入关键词，查找问题、结论、代码和方案</div></div>
        <ArrowRight size={18} strokeWidth={1.8} />
      </Link>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel min-w-0 overflow-hidden">
          <div className="panel-header"><h2 className="panel-title">最近导入</h2><Link href="/search" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-strong)]">查看全部<ArrowRight size={14} /></Link></div>
          {stats.recentConversations.length === 0 ? (
            <div className="p-8 text-sm text-[var(--muted)]">从导入页添加第一个 TXT、Markdown 或 JSON 文件。</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[120px_minmax(220px,1fr)_160px] border-b border-[var(--line)] bg-[var(--bg-tertiary)] px-4 py-2 text-[11px] font-medium text-[var(--muted)]"><span>平台</span><span>标题</span><span>导入时间</span></div>
                {stats.recentConversations.map((conversation) => (
                  <Link key={conversation.id} href={`/conversations/${conversation.id}`} className="grid grid-cols-[120px_minmax(220px,1fr)_160px] items-center border-b border-[var(--line)] px-4 py-3 text-sm last:border-0 hover:bg-[var(--surface-subtle)]">
                    <PlatformBadge platform={conversation.sourcePlatform} />
                    <span className="truncate pr-5 font-medium">{conversation.title}</span>
                    <span className="text-xs tabular-nums text-[var(--muted)]">{formatDateTime(conversation.importedAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header"><h2 className="panel-title">平台分布</h2><span className="text-xs text-[var(--muted)]">{stats.platformDistribution.length} 个来源</span></div>
          <div className="space-y-4 p-5">
            {stats.platformDistribution.map((item) => (
              <div key={item.platform}>
                <div className="mb-1.5 flex items-center justify-between text-sm"><span>{platformLabel(item.platform)}</span><span className="tabular-nums text-[var(--muted)]">{item.count}</span></div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--surface-subtle)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(6, (item.count / maxPlatformCount) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
