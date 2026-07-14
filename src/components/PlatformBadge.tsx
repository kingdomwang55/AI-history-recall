import { platformLabel } from "@/lib/format";

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--muted)]">
      {platformLabel(platform)}
    </span>
  );
}
