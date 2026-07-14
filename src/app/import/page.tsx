import { ImportForm } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">导入历史对话</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          第一版优先支持通用 JSON、Markdown、TXT 和 HTML。ChatGPT、Claude、DeepSeek
          的官方导出 adapter 已预留结构。
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
