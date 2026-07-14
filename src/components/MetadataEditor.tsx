"use client";

import { FormEvent, useState } from "react";
import { Save } from "lucide-react";
import { withApiToken } from "@/lib/client-api";
import { useRouter } from "next/navigation";

export function MetadataEditor({
  conversationId,
  initialTags,
  initialNote
}: {
  conversationId: string;
  initialTags: string[];
  initialNote: string;
}) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags.join(", "));
  const [note, setNote] = useState(initialNote);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const payload = {
      tags: tags
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      note
    };

    try {
      const res = await fetch(`/api/conversations/${conversationId}/metadata`, {
        method: "PUT",
        headers: withApiToken({
          "Content-Type": "application/json"
        }),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "保存失败");
      }

      setStatus("已保存");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5"
    >
      <h2 className="text-lg font-semibold">标签和备注</h2>

      <div className="mt-5 grid gap-2">
        <label htmlFor="tags" className="text-sm font-medium">
          Tags
        </label>
        <input
          id="tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
          placeholder="n8n, AI 编程, 报错解决"
        />
        <p className="text-xs text-[var(--muted)]">用逗号分隔多个标签。</p>
      </div>

      <div className="mt-4 grid gap-2">
        <label htmlFor="note" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={6}
          className="resize-y rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
          placeholder="这段对话解决了什么问题，后续怎么复用"
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={15} strokeWidth={1.8} />
          <span>{pending ? "保存中" : "保存"}</span>
        </button>
        {status ? <span className="text-sm text-[var(--muted)]">{status}</span> : null}
      </div>
    </form>
  );
}
