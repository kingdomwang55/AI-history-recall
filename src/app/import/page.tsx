import { ImportForm } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div>
      <header className="page-header">
        <div>
        <h1 className="page-title">导入历史对话</h1>
        <p className="page-description">
          第一版优先支持通用 JSON、Markdown、TXT 和 HTML。ChatGPT、Claude、DeepSeek
          的官方导出 adapter 已预留结构。
        </p>
        </div>
      </header>
      <ImportForm />
    </div>
  );
}
