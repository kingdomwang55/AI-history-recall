"use client";

import type { Message } from "@/types/conversation";
import { roleLabel } from "@/lib/format";
import { CopyButton } from "./CopyButton";

const roleClasses: Record<Message["role"], string> = {
  user: "border-[color-mix(in_srgb,var(--primary)_20%,transparent)] bg-[var(--primary-soft)]",
  assistant: "border-[var(--line)] bg-[var(--surface)]",
  system: "border-[color-mix(in_srgb,var(--warning)_22%,transparent)] bg-[var(--warning-soft)] text-[var(--foreground)]",
  unknown: "border-[var(--line)] bg-[var(--surface-subtle)]"
};

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <article
          key={message.id}
          className={`rounded-[5px] border p-4 ${roleClasses[message.role]}`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase text-[var(--muted)]">
              {roleLabel(message.role)}
            </div>
            <CopyButton text={message.content} label="复制消息" className="px-2.5 py-1.5" />
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7">
            {message.content}
          </pre>
        </article>
      ))}
    </div>
  );
}
