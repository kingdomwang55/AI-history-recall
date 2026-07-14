"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExtensionRunStatus } from "@/components/capture/capture-types";

const expectedExtensionVersion = "0.1.42";
const expectedExtensionBuildId = "deepseek-pinned-groups-20260715";

export function extensionNeedsUpdate(version?: string, buildId?: string) {
  if (!version) return false;
  const current = version.split(".").map((part) => Number(part) || 0);
  const expected = expectedExtensionVersion.split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(current.length, expected.length); index += 1) {
    const difference = (current[index] || 0) - (expected[index] || 0);
    if (difference < 0) return true;
    if (difference > 0) return false;
  }
  return buildId !== expectedExtensionBuildId;
}

export function useExtensionBridge({
  onCompleted,
  onFailed,
  onStopped
}: {
  onCompleted?: () => void;
  onFailed?: () => void;
  onStopped?: () => void;
} = {}) {
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionMeta, setExtensionMeta] = useState<{ version?: string; buildId?: string }>({});
  const [extensionCheckedAt, setExtensionCheckedAt] = useState<string | null>(null);
  const [extensionBridgeError, setExtensionBridgeError] = useState<string | null>(null);
  const [extensionRun, setExtensionRun] = useState<ExtensionRunStatus | null>(null);

  const requestExtension = useCallback(<T,>(message: Record<string, unknown>, timeoutMs = 5000): Promise<T> => {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        const messageText =
          "没有收到扩展响应。下一步：打开 chrome://extensions，确认 AI History Recall Capture 已启用；如果刚安装或更新过扩展，点 Reload 后回到本页。";
        setExtensionReady(false);
        setExtensionBridgeError(messageText);
        setExtensionCheckedAt(new Date().toISOString());
        reject(new Error(messageText));
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.data?.source !== "aihr-extension") return;
        if (event.data.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (event.data.ok === false) {
          setExtensionBridgeError(event.data.error || "扩展执行失败");
          setExtensionCheckedAt(new Date().toISOString());
          reject(new Error(event.data.error || "扩展执行失败"));
          return;
        }
        setExtensionReady(true);
        setExtensionMeta({
          version: event.data.run?.extensionVersion ?? event.data.version,
          buildId: event.data.run?.extensionBuildId ?? event.data.buildId
        });
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
        resolve(event.data as T);
      };

      window.addEventListener("message", onMessage);
      window.postMessage({ source: "aihr-web", requestId, ...message }, window.location.origin);
    });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== "aihr-extension") return;
      if (event.data.type === "AIHR_EXTENSION_READY") {
        setExtensionReady(true);
        setExtensionMeta({ version: event.data.version, buildId: event.data.buildId });
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
      }
      if (event.data.type === "AIHR_WEB_STATUS_RESULT") {
        setExtensionReady(true);
        setExtensionMeta({
          version: event.data.run?.extensionVersion ?? event.data.version,
          buildId: event.data.run?.extensionBuildId ?? event.data.buildId
        });
        setExtensionRun(event.data.run ?? null);
        setExtensionBridgeError(null);
        setExtensionCheckedAt(new Date().toISOString());
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aihr-web", type: "AIHR_WEB_GET_STATUS", requestId: crypto.randomUUID() },
      window.location.origin
    );
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!extensionReady) return;

    let disposed = false;
    const timer = window.setInterval(() => {
      requestExtension<{ run?: ExtensionRunStatus }>(
        {
          type: "AIHR_WEB_GET_STATUS"
        },
        4000
      )
        .then((response) => {
          if (disposed) return;
          const run = response.run ?? null;
          setExtensionRun(run);

          if (run?.status === "completed") {
            onCompleted?.();
          }

          if (run?.status === "failed") {
            onFailed?.();
          }

          if (run?.status === "stopped") {
            onStopped?.();
          }
        })
        .catch(() => undefined);
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [extensionReady, onCompleted, onFailed, onStopped, requestExtension]);

  return {
    expectedExtensionVersion,
    expectedExtensionBuildId,
    extensionReady,
    extensionMeta,
    extensionCheckedAt,
    extensionBridgeError,
    extensionRun,
    setExtensionRun,
    requestExtension
  };
}
