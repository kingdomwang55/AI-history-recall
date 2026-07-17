import fs from "node:fs";
import path from "node:path";
import {
  nextOnboardingStep,
  normalizeDesktopSettings,
  type DesktopSettings,
  type OnboardingState,
  type OnboardingStep
} from "@/lib/onboarding";

function dataDirectory() {
  const dbPath = process.env.AIHR_DB_PATH || path.join(process.cwd(), "data", "ai-history-recall.sqlite");
  return path.dirname(path.resolve(dbPath));
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writePrivateJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on Windows and filesystems without POSIX permissions.
  }
}

export function getDesktopDataDirectory() {
  return dataDirectory();
}

export function getOnboardingState(): OnboardingState {
  const raw = readJson(path.join(dataDirectory(), "onboarding.json"));
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  return {
    storage: value.storage === true,
    extension: value.extension === true,
    firstData: value.firstData === true,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null
  };
}

export function completeOnboardingStep(step: Exclude<OnboardingStep, "complete">) {
  const state = getOnboardingState();
  if (step === "storage") state.storage = true;
  if (step === "extension") state.extension = true;
  if (step === "first-data") state.firstData = true;
  if (nextOnboardingStep(state) === "complete") state.completedAt ||= new Date().toISOString();
  writePrivateJson(path.join(dataDirectory(), "onboarding.json"), state);
  return state;
}

export function getDesktopSettings(): DesktopSettings {
  return normalizeDesktopSettings(readJson(path.join(dataDirectory(), "desktop-settings.json")));
}

export function saveDesktopSettings(value: unknown) {
  const settings = normalizeDesktopSettings(value);
  writePrivateJson(path.join(dataDirectory(), "desktop-settings.json"), settings);
  applyDesktopSettingsEnvironment(settings);
  return settings;
}

export function applyDesktopSettingsEnvironment(settings = getDesktopSettings()) {
  if (settings.embeddingProvider === "disabled") {
    delete process.env.AIHR_EMBEDDING_PROVIDER;
    delete process.env.AIHR_EMBEDDING_MODEL;
    delete process.env.AIHR_EMBEDDING_BASE_URL;
    delete process.env.AIHR_EMBEDDING_API_KEY;
  } else {
    process.env.AIHR_EMBEDDING_PROVIDER = settings.embeddingProvider;
    process.env.AIHR_EMBEDDING_MODEL = settings.embeddingModel;
    process.env.AIHR_EMBEDDING_BASE_URL = settings.embeddingBaseUrl;
    process.env.AIHR_EMBEDDING_API_KEY = settings.embeddingApiKey;
  }
  process.env.AIHR_KNOWLEDGE_MODEL_ENABLED = String(settings.knowledgeModelEnabled);
  process.env.LLM_MODEL = settings.knowledgeModel;
  process.env.LLM_BASE_URL = settings.knowledgeBaseUrl;
  process.env.LLM_API_KEY = settings.knowledgeApiKey;
  return settings;
}
