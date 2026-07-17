import { requireApiToken } from "@/lib/api-auth";
import { readJsonBody } from "@/lib/api-security";
import { nextOnboardingStep, type OnboardingStep } from "@/lib/onboarding";
import {
  completeOnboardingStep,
  getDesktopDataDirectory,
  getDesktopSettings,
  getOnboardingState,
  saveDesktopSettings
} from "@/services/desktop-settings-service";
import { getHealthReport, redactHealthReport } from "@/services/health-check-service";
import { getKnowledgeModelStatus } from "@/services/knowledge-model-service";
import { createDesktopBackup, restoreDesktopBackup } from "@/services/desktop-backup-service";
import path from "node:path";

export const runtime = "nodejs";

function statusPayload() {
  const onboarding = getOnboardingState();
  return {
    desktop: Boolean(process.env.AIHR_API_TOKEN),
    dataDirectory: getDesktopDataDirectory(),
    extensionDirectory: process.env.AIHR_DESKTOP_RESOURCE_DIR
      ? path.join(process.env.AIHR_DESKTOP_RESOURCE_DIR, "resources", "extension")
      : path.join(process.cwd(), "extension"),
    onboarding,
    nextStep: nextOnboardingStep(onboarding),
    settings: getDesktopSettings(),
    health: redactHealthReport(getHealthReport()),
    knowledgeModel: getKnowledgeModelStatus()
  };
}

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  if (new URL(request.url).searchParams.get("download") === "backup") {
    const backup = createDesktopBackup();
    return new Response(backup.bytes, {
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${backup.filename}"`,
        "cache-control": "no-store"
      }
    });
  }
  return Response.json(statusPayload());
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;
  if (request.headers.get("content-type")?.toLocaleLowerCase().startsWith("multipart/form-data")) {
    const declared = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declared) && declared > 512 * 1024 * 1024) {
      return Response.json({ error: "备份文件过大" }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("database");
    if (!(file instanceof File)) return Response.json({ error: "请选择 SQLite 备份" }, { status: 400 });
    try {
      return Response.json(await restoreDesktopBackup(file));
    } catch (restoreError) {
      return Response.json(
        { error: restoreError instanceof Error ? restoreError.message : "恢复失败" },
        { status: 400 }
      );
    }
  }
  const { data, error } = await readJsonBody(request);
  if (error) return error;
  if (!data || typeof data !== "object") return Response.json({ error: "Invalid desktop action" }, { status: 400 });
  const raw = data as { action?: unknown; step?: unknown; settings?: unknown };
  if (raw.action === "complete-step") {
    if (!["storage", "extension", "first-data"].includes(String(raw.step))) {
      return Response.json({ error: "Invalid onboarding step" }, { status: 400 });
    }
    completeOnboardingStep(raw.step as Exclude<OnboardingStep, "complete">);
    return Response.json(statusPayload());
  }
  if (raw.action === "save-settings") {
    saveDesktopSettings(raw.settings);
    return Response.json({ ...statusPayload(), restartRequired: true });
  }
  return Response.json({ error: "Unknown desktop action" }, { status: 400 });
}
