"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, RotateCcw, Save, Upload } from "lucide-react";
import { withApiToken } from "@/lib/client-api";
import type { DesktopSettings as Settings, SyncPlatform } from "@/lib/onboarding";
import { useLanguage } from "@/components/LanguageProvider";
import type { Language } from "@/lib/i18n";

interface Status { settings: Settings; dataDirectory: string; restartRequired?: boolean }

const syncPlatforms: Array<{ platform: SyncPlatform; name: string }> = [
  { platform: "chatgpt", name: "ChatGPT" },
  { platform: "gemini", name: "Gemini" },
  { platform: "deepseek", name: "DeepSeek" },
  { platform: "qwen", name: "通义千问" }
];

async function request(init?: RequestInit) {
  const response = await fetch("/api/desktop/status", { ...init, cache: "no-store", headers: withApiToken(init?.headers) });
  if (!response.ok) throw new Error((await response.json()).error || "设置操作失败");
  return response;
}

export function DesktopSettings() {
  const { setLanguage, t } = useLanguage();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataDirectory, setDataDirectory] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    request().then((response) => response.json() as Promise<Status>).then((status) => { setSettings(status.settings); setDataDirectory(status.dataDirectory); }).catch((error) => setNotice(error.message));
    import("@tauri-apps/plugin-autostart").then(({ isEnabled }) => isEnabled()).then(setLaunchAtLogin).catch(() => undefined);
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true); setNotice("");
    try {
      const response = await request({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-settings", settings }) });
      const status = await response.json() as Status;
      setSettings(status.settings);
      await fetch("/api/desktop/extension-bridge", {
        method: "POST",
        cache: "no-store",
        headers: withApiToken({ "content-type": "application/json" }),
        body: JSON.stringify({
          kind: "command",
          message: {
            type: "AIHR_WEB_SET_BACKGROUND_SYNC_SETTINGS",
            settings: {
              enabled: status.settings.backgroundCapture,
              platforms: status.settings.platformSync
            }
          }
        })
      }).catch(() => undefined);
      try {
        const autostart = await import("@tauri-apps/plugin-autostart");
        if (launchAtLogin) await autostart.enable(); else await autostart.disable();
      } catch { /* Browser mode has no native autostart API. */ }
      setNotice("设置已保存；模型配置将在后台服务重启后生效。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function restore(file: File) {
    setBusy(true); setNotice("");
    try {
      const form = new FormData();
      form.set("database", file);
      await request({ method: "POST", body: form });
      setNotice("备份已恢复，原数据库已保留为回滚副本。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "恢复失败"); }
    finally { setBusy(false); }
  }

  async function downloadBackup() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/desktop/status?download=backup", { headers: withApiToken() });
      if (!response.ok) throw new Error((await response.json()).error || "备份失败");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ai-history-recall-${new Date().toISOString().slice(0, 10)}.sqlite`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("备份已下载。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "备份失败"); }
    finally { setBusy(false); }
  }

  if (!settings) return <div className="desktop-loading"><Loader2 className="health-spin" size={18} /> 正在读取设置</div>;
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  const updateLanguage = (value: Language) => {
    update("language", value);
    setLanguage(value);
  };
  const updatePlatformSync = (platform: SyncPlatform, patch: Partial<Settings["platformSync"][SyncPlatform]>) => {
    setSettings({
      ...settings,
      platformSync: {
        ...settings.platformSync,
        [platform]: { ...settings.platformSync[platform], ...patch }
      }
    });
  };
  return <div className="settings-workspace">
    <section className="settings-section"><div className="settings-heading"><h2>启动与后台</h2><p>{dataDirectory}</p></div>
      <label className="settings-field"><span>{t("settings.language")}</span><select value={settings.language} onChange={(event) => updateLanguage(event.target.value as Language)}><option value="zh-CN">{t("settings.language.zh")}</option><option value="en-US">{t("settings.language.en")}</option></select><small className="text-[10px] text-[var(--muted)]">{t("settings.languageHint")}</small></label>
      <label className="settings-toggle"><span><strong>登录时启动</strong><small>仅显示托盘，不打开窗口</small></span><input type="checkbox" checked={launchAtLogin} onChange={(event) => setLaunchAtLogin(event.target.checked)} /></label>
      <label className="settings-toggle"><span><strong>关闭到托盘</strong><small>销毁界面并保留轻量后台服务</small></span><input type="checkbox" checked={settings.closeToTray} onChange={(event) => update("closeToTray", event.target.checked)} /></label>
      <label className="settings-toggle"><span><strong>浏览器后台采集</strong><small>允许扩展按计划检查新对话</small></span><input type="checkbox" checked={settings.backgroundCapture} onChange={(event) => update("backgroundCapture", event.target.checked)} /></label>
      <div className="platform-sync-settings">
        <div className="settings-heading settings-heading-compact"><h3>平台同步策略</h3><p>独立控制频率和扫描预算，降低常驻资源占用</p></div>
        {syncPlatforms.map(({ platform, name }) => {
          const strategy = settings.platformSync[platform];
          return <div className="platform-sync-row" key={platform}>
            <label className="settings-toggle platform-sync-enabled"><span><strong>{name}</strong><small>{strategy.enabled ? `${strategy.intervalMinutes} 分钟检查一次` : "已暂停后台检查"}</small></span><input type="checkbox" checked={strategy.enabled} onChange={(event) => updatePlatformSync(platform, { enabled: event.target.checked })} /></label>
            <label className="settings-field"><span>间隔</span><input type="number" min={60} max={1440} step={30} value={strategy.intervalMinutes} onChange={(event) => updatePlatformSync(platform, { intervalMinutes: Number(event.target.value) })} /></label>
            <label className="settings-field"><span>条数</span><input type="number" min={20} max={100} step={5} value={strategy.scanLimit} onChange={(event) => updatePlatformSync(platform, { scanLimit: Number(event.target.value) })} /></label>
            <label className="settings-field"><span>滚动</span><input type="number" min={5} max={80} step={5} value={strategy.maxScrolls} onChange={(event) => updatePlatformSync(platform, { maxScrolls: Number(event.target.value) })} /></label>
            <label className="settings-field"><span>遇旧停止</span><input type="number" min={3} max={30} step={1} value={strategy.stopAfterKnown} onChange={(event) => updatePlatformSync(platform, { stopAfterKnown: Number(event.target.value) })} /></label>
          </div>;
        })}
      </div>
      <label className="settings-toggle"><span><strong>后台知识处理</strong><small>空闲时生成摘要、标签和相似对话</small></span><input type="checkbox" checked={settings.knowledgeProcessing} onChange={(event) => update("knowledgeProcessing", event.target.checked)} /></label>
    </section>

    <section className="settings-section"><div className="settings-heading"><h2>检索与模型</h2><p>默认使用内置本地规则，不请求模型</p></div>
      <label className="settings-field"><span>外部 Embedding</span><select value={settings.embeddingProvider} onChange={(event) => update("embeddingProvider", event.target.value as Settings["embeddingProvider"])}><option value="disabled">不启用</option><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI 兼容接口</option></select></label>
      {settings.embeddingProvider !== "disabled" ? <div className="settings-grid"><label className="settings-field"><span>模型</span><input value={settings.embeddingModel} onChange={(event) => update("embeddingModel", event.target.value)} placeholder="embeddinggemma" /></label><label className="settings-field"><span>接口地址</span><input value={settings.embeddingBaseUrl} onChange={(event) => update("embeddingBaseUrl", event.target.value)} placeholder="http://127.0.0.1:11434" /></label>{settings.embeddingProvider === "openai-compatible" ? <label className="settings-field settings-grid-wide"><span>API Key</span><input type="password" value={settings.embeddingApiKey} onChange={(event) => update("embeddingApiKey", event.target.value)} autoComplete="off" /></label> : null}</div> : null}
      <label className="settings-toggle"><span><strong>生成模型增强</strong><small>用于自动摘要和标签；Gemma 文本模型可用于此处</small></span><input type="checkbox" checked={settings.knowledgeModelEnabled} onChange={(event) => update("knowledgeModelEnabled", event.target.checked)} /></label>
      {settings.knowledgeModelEnabled ? <div className="settings-grid"><label className="settings-field"><span>模型</span><input value={settings.knowledgeModel} onChange={(event) => update("knowledgeModel", event.target.value)} placeholder="gemma" /></label><label className="settings-field"><span>Chat Completions 地址</span><input value={settings.knowledgeBaseUrl} onChange={(event) => update("knowledgeBaseUrl", event.target.value)} placeholder="http://127.0.0.1:11434/v1" /></label><label className="settings-field settings-grid-wide"><span>API Key</span><input type="password" value={settings.knowledgeApiKey} onChange={(event) => update("knowledgeApiKey", event.target.value)} autoComplete="off" /></label></div> : null}
    </section>

    <section className="settings-section"><div className="settings-heading"><h2>数据维护</h2><p>恢复前自动校验数据库并保留回滚副本</p></div><div className="desktop-action-row"><button className="desktop-secondary-button" disabled={busy} onClick={downloadBackup}><Download size={15} />下载备份</button><label className="desktop-secondary-button"><Upload size={15} />恢复备份<input type="file" accept=".sqlite,.db" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void restore(file); event.target.value = ""; }}/></label><a className="desktop-secondary-button" href="/health"><RotateCcw size={15} />诊断与修复</a></div></section>
    <div className="settings-save-bar"><span>{notice}</span><button className="desktop-primary-button" disabled={busy} onClick={save}>{busy ? <Loader2 className="health-spin" size={15} /> : <Save size={15} />}保存设置</button></div>
  </div>;
}
