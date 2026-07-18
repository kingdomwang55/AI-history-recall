import { ImportForm } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div>
      <header className="page-header">
        <div>
        <h1 className="page-title">导入历史对话</h1>
        <p className="page-description">
          支持通用 JSON、Markdown、TXT、HTML，以及 ChatGPT、Claude、DeepSeek 和通义千问的官方 JSON 导出。
        </p>
        </div>
      </header>
      <ImportForm />
    </div>
  );
}
