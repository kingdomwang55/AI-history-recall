import { normalizeLanguage, type Language } from "@/lib/i18n";

export type OnboardingStep = "storage" | "extension" | "first-data" | "complete";

export interface OnboardingState {
  storage?: boolean;
  extension?: boolean;
  firstData?: boolean;
  completedAt?: string | null;
}

export interface DesktopSettings {
  language: Language;
  closeToTray: boolean;
  backgroundCapture: boolean;
  platformSync: PlatformSyncSettings;
  knowledgeProcessing: boolean;
  embeddingProvider: "disabled" | "ollama" | "openai-compatible";
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  knowledgeModelEnabled: boolean;
  knowledgeModel: string;
  knowledgeBaseUrl: string;
  knowledgeApiKey: string;
}

export type SyncPlatform = "chatgpt" | "gemini" | "deepseek" | "qwen";

export interface PlatformSyncStrategy {
  enabled: boolean;
  intervalMinutes: number;
  scanLimit: number;
  maxScrolls: number;
  stopAfterKnown: number;
}

export type PlatformSyncSettings = Record<SyncPlatform, PlatformSyncStrategy>;

const defaultPlatformSyncSettings: PlatformSyncSettings = {
  chatgpt: { enabled: true, intervalMinutes: 360, scanLimit: 50, maxScrolls: 30, stopAfterKnown: 10 },
  gemini: { enabled: true, intervalMinutes: 360, scanLimit: 50, maxScrolls: 30, stopAfterKnown: 10 },
  deepseek: { enabled: true, intervalMinutes: 360, scanLimit: 50, maxScrolls: 30, stopAfterKnown: 10 },
  qwen: { enabled: true, intervalMinutes: 720, scanLimit: 40, maxScrolls: 20, stopAfterKnown: 8 }
};

export function nextOnboardingStep(state: OnboardingState): OnboardingStep {
  if (!state.storage) return "storage";
  if (!state.extension) return "extension";
  if (!state.firstData) return "first-data";
  return "complete";
}

function text(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(Math.round(next), min), max);
}

export function normalizePlatformSyncSettings(value: unknown): PlatformSyncSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return (Object.keys(defaultPlatformSyncSettings) as SyncPlatform[]).reduce((result, platform) => {
    const defaults = defaultPlatformSyncSettings[platform];
    const item = raw[platform] && typeof raw[platform] === "object"
      ? (raw[platform] as Record<string, unknown>)
      : {};
    result[platform] = {
      enabled: item.enabled !== false,
      intervalMinutes: boundedNumber(item.intervalMinutes, defaults.intervalMinutes, 60, 1440),
      scanLimit: boundedNumber(item.scanLimit, defaults.scanLimit, 20, 100),
      maxScrolls: boundedNumber(item.maxScrolls, defaults.maxScrolls, 5, 80),
      stopAfterKnown: boundedNumber(item.stopAfterKnown, defaults.stopAfterKnown, 3, 30)
    };
    return result;
  }, {} as PlatformSyncSettings);
}

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const embeddingProvider = ["ollama", "openai-compatible"].includes(String(raw.embeddingProvider))
    ? (raw.embeddingProvider as DesktopSettings["embeddingProvider"])
    : "disabled";
  return {
    language: normalizeLanguage(raw.language),
    closeToTray: raw.closeToTray !== false,
    backgroundCapture: raw.backgroundCapture !== false,
    platformSync: normalizePlatformSyncSettings(raw.platformSync),
    knowledgeProcessing: raw.knowledgeProcessing !== false,
    embeddingProvider,
    embeddingModel: text(raw.embeddingModel, 120),
    embeddingBaseUrl: text(raw.embeddingBaseUrl, 500),
    embeddingApiKey: text(raw.embeddingApiKey, 500),
    knowledgeModelEnabled: raw.knowledgeModelEnabled === true,
    knowledgeModel: text(raw.knowledgeModel, 120),
    knowledgeBaseUrl: text(raw.knowledgeBaseUrl, 500),
    knowledgeApiKey: text(raw.knowledgeApiKey, 500)
  };
}
