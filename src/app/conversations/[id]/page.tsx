import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ConversationManagementPanel } from "@/components/ConversationManagementPanel";
import { CopyButton } from "@/components/CopyButton";
import { MessageList } from "@/components/MessageList";
import { MetadataEditor } from "@/components/MetadataEditor";
import { PlatformBadge } from "@/components/PlatformBadge";
import { buildConversationText, formatDateTime } from "@/lib/format";
import { getConversation } from "@/services/conversation-service";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const conversation = getConversation(id);

  if (!conversation) {
    notFound();
  }

  const backHref = from ? `/search?${from}` : "/search";

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-strong)]"
      >
        <ArrowLeft size={16} strokeWidth={1.8} />
        <span>返回搜索结果</span>
      </Link>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <PlatformBadge platform={conversation.sourcePlatform} />
              <span className="text-xs text-[var(--muted)]">
                导入于 {formatDateTime(conversation.importedAt)}
              </span>
            </div>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="break-words text-3xl font-semibold">
                  {conversation.title}
                </h1>
                {conversation.rawFileName ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    原始文件：{conversation.rawFileName}
                  </p>
                ) : null}
              </div>
              <CopyButton
                text={buildConversationText(conversation.title, conversation.messages)}
                label="复制整段对话"
                className="shrink-0"
              />
            </div>

            {conversation.tags.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {conversation.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-[var(--surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-6">
            <MessageList messages={conversation.messages} />
          </div>
        </div>

        <aside className="space-y-6">
          <MetadataEditor
            conversationId={conversation.id}
            initialTags={conversation.tags}
            initialNote={conversation.note}
          />

          <ConversationManagementPanel conversationId={conversation.id} />

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
            <h2 className="text-base font-semibold text-[var(--foreground)]">对话信息</h2>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="font-medium text-[var(--foreground)]">消息数</dt>
                <dd>{conversation.messages.length}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--foreground)]">创建时间</dt>
                <dd>{formatDateTime(conversation.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--foreground)]">更新时间</dt>
                <dd>{formatDateTime(conversation.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>
    </div>
  );
}
