"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { withApiToken } from "@/lib/client-api";

type ExportFormat = "markdown" | "json";

function extensionFor(format: ExportFormat) {
  return format === "json" ? "json" : "md";
}

export function ConversationExportButtons({
  conversationId,
  title
}: {
  conversationId: string;
  title: string;
}) {
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportConversation(format: ExportFormat) {
    setPending(format);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}/export?format=${format}`, {
        headers: withApiToken()
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "导出失败");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title || conversationId}.${extensionFor(format)}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => exportConversation("markdown")}
        disabled={pending !== null}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download size={15} strokeWidth={1.8} />
        <span>{pending === "markdown" ? "导出中" : "Markdown"}</span>
      </button>
      <button
        type="button"
        onClick={() => exportConversation("json")}
        disabled={pending !== null}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download size={15} strokeWidth={1.8} />
        <span>{pending === "json" ? "导出中" : "JSON"}</span>
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
