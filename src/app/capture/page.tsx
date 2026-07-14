import { CapturePlanner } from "@/components/CapturePlanner";

export default function CapturePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">浏览器采集</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          让常驻 Chrome 扩展在你已登录的浏览器里打开 ChatGPT、Gemini、DeepSeek、通义千问，
          低频滚动、后台提取对话，并写入本地 SQLite。页面会自动跟进状态，尽量不让你记复杂步骤。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 text-sm leading-6 text-[var(--muted)]">
        <div className="font-medium text-[var(--foreground)]">第一次使用</div>
        <div className="mt-2">
          先在 Chrome 加载本项目的 <code>extension/</code> 扩展。之后主要使用下面的一个按钮：
          它会检查连接、读取审计、选择需要采集的平台，并把任务交给扩展在后台低频执行。
        </div>
      </div>

      <CapturePlanner />
    </div>
  );
}
