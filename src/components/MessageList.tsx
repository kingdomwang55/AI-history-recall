"use client";

import type { Message } from "@/types/conversation";
import { roleLabel } from "@/lib/format";
import { CopyButton } from "./CopyButton";

const roleClasses: Record<Message["role"], string> = {
  user: "border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))]",
  assistant: "border-[var(--line)] bg-[var(--surface)]",
  system: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  unknown: "border-[var(--line)] bg-[var(--surface-subtle)]"
};

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <article
          key={message.id}
          className={`rounded-lg border p-4 ${roleClasses[message.role]}`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {roleLabel(message.role)}
            </div>
            <CopyButton text={message.content} label="复制消息" className="px-2.5 py-1.5" />
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
            {message.content}
          </pre>
        </article>
      ))}
    </div>
  );
}
