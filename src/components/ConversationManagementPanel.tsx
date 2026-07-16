"use client";

import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { withApiToken } from "@/lib/client-api";

export function ConversationManagementPanel({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"delete" | "reindex" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function deleteCurrentConversation() {
    if (!window.confirm("删除这段对话？此操作会同时移除消息、备注、标签关联和搜索索引。")) {
      return;
    }

    setPending("delete");
    setStatus(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
        headers: withApiToken()
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "删除失败");
      }

      router.push("/search");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败");
    } finally {
      setPending(null);
    }
  }

  async function reindexAllSearch() {
    if (!window.confirm("重建本地搜索索引？这会从已保存消息重新生成 FTS 和语义索引。")) {
      return;
    }

    setPending("reindex");
    setStatus(null);

    try {
      const response = await fetch("/api/search/reindex", {
        method: "POST",
        headers: withApiToken()
      });
      const data = (await response.json()) as {
        error?: string;
        indexedMessages?: number;
        indexedSemanticMessages?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "重建失败");
      }

      setStatus(`已重建 ${data.indexedMessages ?? 0} 条全文索引，${data.indexedSemanticMessages ?? 0} 条语义索引`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "重建失败");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="border-t border-[var(--line)] p-5 text-sm">
      <h2 className="text-base font-semibold text-[var(--foreground)]">维护</h2>
      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={reindexAllSearch}
          disabled={pending !== null}
          className="inline-flex items-center justify-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-medium transition hover:bg-[var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={15} strokeWidth={1.8} />
          <span>{pending === "reindex" ? "重建中" : "重建搜索与语义索引"}</span>
        </button>
        <button
          type="button"
          onClick={deleteCurrentConversation}
          disabled={pending !== null}
          className="inline-flex items-center justify-center gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--danger)_22%,transparent)] bg-transparent px-3 py-2 font-medium text-[var(--danger)] transition hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 size={15} strokeWidth={1.8} />
          <span>{pending === "delete" ? "删除中" : "删除这段对话"}</span>
        </button>
      </div>
      {status ? <div className="mt-3 text-xs leading-5 text-[var(--muted)]">{status}</div> : null}
    </div>
  );
}
