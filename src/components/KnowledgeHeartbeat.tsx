"use client";

import { useEffect } from "react";
import { withApiToken } from "@/lib/client-api";

const HEARTBEAT_INTERVAL_MS = 60_000;
const heartbeatRuntime = globalThis as typeof globalThis & { aihrLastKnowledgeHeartbeatAt?: number };

function lastHeartbeatAt() {
  return heartbeatRuntime.aihrLastKnowledgeHeartbeatAt ?? 0;
}

export function KnowledgeHeartbeat() {
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(delay: number) {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    }

    async function run() {
      if (!active || document.visibilityState !== "visible") return;
      const elapsed = Date.now() - lastHeartbeatAt();
      if (elapsed < HEARTBEAT_INTERVAL_MS) {
        schedule(HEARTBEAT_INTERVAL_MS - elapsed);
        return;
      }
      heartbeatRuntime.aihrLastKnowledgeHeartbeatAt = Date.now();
      try {
        const response = await fetch("/api/knowledge/process", {
          method: "POST",
          headers: withApiToken({ "content-type": "application/json" }),
          body: JSON.stringify({ limit: 2 })
        });
        if (!response.ok) throw new Error("Knowledge heartbeat failed");
        const result = (await response.json()) as { queue: { pending: number } };
        if (result.queue.pending > 0) schedule(HEARTBEAT_INTERVAL_MS);
      } catch {
        schedule(HEARTBEAT_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "visible") {
        schedule(Math.max(0, HEARTBEAT_INTERVAL_MS - (Date.now() - lastHeartbeatAt())));
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") schedule(0);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
