"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { withApiToken } from "@/lib/client-api";

type QueueStatus = { pending: number; running: number; completed: number; failed: number; total: number };

export function KnowledgeManagementPanel() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/knowledge/status", { headers: withApiToken(), cache: "no-store" });
    if (!response.ok) throw new Error("无法读取知识队列");
    const result = (await response.json()) as { queue: QueueStatus };
    setQueue(result.queue);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge/status", { headers: withApiToken(), cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("无法读取知识队列");
        return response.json() as Promise<{ queue: QueueStatus }>;
      })
      .then((result) => {
        if (!cancelled) setQueue(result.queue);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function processNow() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/knowledge/process", {
        method: "POST",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({ limit: 10 })
      });
      if (!response.ok) throw new Error("知识处理失败");
      const result = (await response.json()) as { completed: number; failed: number; queue: QueueStatus };
      setQueue(result.queue);
      setMessage(`已处理 ${result.completed} 条${result.failed ? `，失败 ${result.failed} 条` : ""}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识处理失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="knowledge-management-panel">
      <div className="knowledge-management-heading"><div><h2>知识处理</h2><p>待处理 {queue?.pending ?? "-"} · 运行中 {queue?.running ?? "-"} · 失败 {queue?.failed ?? "-"}</p></div><button type="button" title="刷新队列" aria-label="刷新队列" onClick={() => refresh().catch(() => undefined)}><RefreshCw size={14} /></button></div>
      <button className="knowledge-process-button" type="button" onClick={processNow} disabled={pending || queue?.pending === 0}>
        <Sparkles size={14} />
        <span>{pending ? "处理中" : "立即处理"}</span>
      </button>
      {message ? <p className="knowledge-management-message" role="status">{message}</p> : null}
    </section>
  );
}
