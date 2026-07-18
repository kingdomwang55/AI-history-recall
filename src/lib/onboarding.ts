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

export function nextOnboardingStep(state: OnboardingState): OnboardingStep {
  if (!state.storage) return "storage";
  if (!state.extension) return "extension";
  if (!state.firstData) return "first-data";
  return "complete";
}

function text(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
