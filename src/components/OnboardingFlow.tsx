"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Database, ExternalLink, Loader2, Plug, Upload } from "lucide-react";
import { withApiToken } from "@/lib/client-api";
import type { DesktopSettings, OnboardingState, OnboardingStep } from "@/lib/onboarding";

interface DesktopStatus {
  dataDirectory: string;
  extensionDirectory: string;
  onboarding: OnboardingState;
  nextStep: OnboardingStep;
  settings: DesktopSettings;
  health: { status: string };
}

const steps = [
  { id: "storage", label: "本地存储", icon: Database },
  { id: "extension", label: "浏览器扩展", icon: Plug },
  { id: "first-data", label: "首批数据", icon: Upload }
] as const;

async function desktopRequest(init?: RequestInit) {
  const response = await fetch("/api/desktop/status", {
    ...init,
    cache: "no-store",
    headers: withApiToken(init?.headers)
  });
  if (!response.ok) throw new Error((await response.json()).error || "桌面服务不可用");
  return response.json() as Promise<DesktopStatus>;
}

export function OnboardingFlow() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    desktopRequest().then(setStatus).catch((error) => setNotice(error.message));
  }, []);

  useEffect(load, [load]);

  async function complete(step: Exclude<OnboardingStep, "complete">) {
    setBusy(true);
    setNotice("");
    try {
      setStatus(
        await desktopRequest({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "complete-step", step })
        })
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function pairExtension() {
    setBusy(true);
    setNotice("");
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const current = await desktopRequest();
        setStatus(current);
        if (current.onboarding.extension) return;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      throw new Error("未检测到扩展，请在扩展管理页刷新后重试");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "扩展配对失败");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <div className="desktop-loading"><Loader2 className="health-spin" size={18} /> 正在连接本地服务</div>;
  }

  const current = status.nextStep;
  return (
    <div className="onboarding-workspace">
      <ol className="onboarding-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const done = steps.findIndex((item) => item.id === current) > index || current === "complete";
          return <li key={step.id} data-active={current === step.id} data-done={done}><span>{done ? <Check size={15} /> : <Icon size={15} />}</span><div><small>步骤 {index + 1}</small><strong>{step.label}</strong></div></li>;
        })}
      </ol>

      <section className="onboarding-panel">
        {current === "storage" ? <>
          <div className="section-kicker">本地存储</div><h1>确认数据位置</h1>
          <div className="desktop-path"><code>{status.dataDirectory}</code><button title="复制路径" onClick={() => navigator.clipboard.writeText(status.dataDirectory)}><Copy size={15} /></button></div>
          <p className="desktop-state-line"><span className={`status-dot ${status.health.status === "healthy" ? "status-dot-success" : "status-dot-warning"}`} />数据库已创建并通过本地检查</p>
          <button className="desktop-primary-button" disabled={busy} onClick={() => complete("storage")}>使用此位置</button>
        </> : null}

        {current === "extension" ? <>
          <div className="section-kicker">浏览器扩展</div><h1>连接采集扩展</h1>
          <div className="desktop-path"><code>{status.extensionDirectory}</code><button title="复制扩展目录" onClick={() => navigator.clipboard.writeText(status.extensionDirectory)}><Copy size={15} /></button></div>
          <div className="desktop-action-row"><button className="desktop-secondary-button" onClick={() => navigator.clipboard.writeText("chrome://extensions")}><Copy size={15} />复制扩展管理地址</button><Link className="desktop-secondary-button" href="/capture"><ExternalLink size={15} />查看采集状态</Link></div>
          <button className="desktop-primary-button" disabled={busy} onClick={pairExtension}>{busy ? <Loader2 className="health-spin" size={15} /> : <Plug size={15} />}配对扩展</button>
        </> : null}

        {current === "first-data" ? <>
          <div className="section-kicker">首批数据</div><h1>建立第一份可检索记录</h1>
          <div className="first-data-actions"><Link href="/import"><Upload size={18} /><strong>导入文件</strong><span>JSON、Markdown 或文本</span></Link><Link href="/capture"><Plug size={18} /><strong>浏览器采集</strong><span>从已登录平台同步</span></Link></div>
          <button className="desktop-primary-button" disabled={busy} onClick={() => complete("first-data")}>完成设置</button>
        </> : null}

        {current === "complete" ? <><div className="onboarding-complete-icon"><Check size={24} /></div><h1>准备就绪</h1><p>后台服务已启动，关闭窗口后仍会保持本地采集能力。</p><Link className="desktop-primary-button" href="/">进入首页</Link></> : null}
        {notice ? <p className="desktop-notice" role="status">{notice}</p> : null}
      </section>
    </div>
  );
}
