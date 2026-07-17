import Link from "next/link";
import { Settings } from "lucide-react";
import { CapturePlanner } from "@/components/CapturePlanner";

export default function CapturePage() {
  return (
    <div>
      <header className="page-header">
        <div>
        <h1 className="page-title">浏览器采集</h1>
        <p className="page-description">
          常驻扩展在你已登录的 Chrome 中低频同步 ChatGPT、Gemini、DeepSeek 和通义千问。
          新对话自动入库，旧对话只追加新消息，全部写入本地 SQLite。
        </p>
        </div>
        <Link className="desktop-secondary-button" href="/onboarding"><Settings size={15} />设置向导</Link>
      </header>

      <CapturePlanner />
    </div>
  );
}
