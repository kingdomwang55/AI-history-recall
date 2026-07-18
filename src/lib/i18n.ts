export type Language = "zh-CN" | "en-US";

export const defaultLanguage: Language = "zh-CN";

export function normalizeLanguage(value: unknown): Language {
  return value === "en-US" ? "en-US" : "zh-CN";
}

export const translations = {
  "zh-CN": {
    "nav.home": "首页",
    "nav.capture": "采集",
    "nav.search": "搜索",
    "nav.import": "导入",
    "nav.health": "健康",
    "nav.settings": "设置",
    "nav.main": "主要导航",
    "nav.mobile": "移动端导航",
    "nav.localMode": "本地模式",
    "nav.localOnly": "数据仅保存在本机",
    "nav.searchPlaceholder": "搜索历史对话",
    "nav.searchAria": "搜索历史对话",
    "nav.language": "语言",
    "settings.language": "界面语言",
    "settings.languageHint": "切换导航、设置和主要工作流文案",
    "settings.language.zh": "中文",
    "settings.language.en": "English",
    "page.capture.title": "浏览器采集",
    "page.capture.description":
      "常驻扩展在你已登录的 Chrome 中低频同步 ChatGPT、Gemini、DeepSeek 和通义千问。新对话自动入库，旧对话只追加新消息，全部写入本地 SQLite。",
    "page.capture.setup": "设置向导",
    "page.settings.kicker": "桌面应用",
    "page.settings.title": "设置",
    "page.settings.reopen": "重新打开设置向导"
  },
  "en-US": {
    "nav.home": "Home",
    "nav.capture": "Capture",
    "nav.search": "Search",
    "nav.import": "Import",
    "nav.health": "Health",
    "nav.settings": "Settings",
    "nav.main": "Main navigation",
    "nav.mobile": "Mobile navigation",
    "nav.localMode": "Local mode",
    "nav.localOnly": "Data stays on this device",
    "nav.searchPlaceholder": "Search conversations",
    "nav.searchAria": "Search conversation history",
    "nav.language": "Language",
    "settings.language": "Interface language",
    "settings.languageHint": "Switch navigation, settings, and primary workflow copy",
    "settings.language.zh": "中文",
    "settings.language.en": "English",
    "page.capture.title": "Browser Capture",
    "page.capture.description":
      "The resident extension quietly syncs ChatGPT, Gemini, DeepSeek, and Qwen from your signed-in Chrome. New conversations are saved locally, existing conversations only append new messages, and everything stays in SQLite.",
    "page.capture.setup": "Setup Wizard",
    "page.settings.kicker": "Desktop App",
    "page.settings.title": "Settings",
    "page.settings.reopen": "Reopen Setup Wizard"
  }
} satisfies Record<Language, Record<string, string>>;

export type TranslationKey = keyof typeof translations["zh-CN"];

export function translate(language: Language, key: TranslationKey) {
  return translations[language][key] ?? translations[defaultLanguage][key] ?? key;
}
