import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./path-alias-loader.mjs", import.meta.url);

const { nextOnboardingStep, normalizeDesktopSettings } = await import("../src/lib/onboarding.ts");
const desktopRoute = await import("../src/app/api/desktop/status/route.ts");
const { closeDb } = await import("../src/lib/db.ts");

function desktopRequest(pathname = "", init = {}) {
  return new Request(`http://127.0.0.1:32145/api/desktop/status${pathname}`, {
    ...init,
    headers: { "X-AIHR-API-Token": "desktop-test-token", ...(init.headers || {}) }
  });
}

test.afterEach(() => {
  closeDb();
  delete process.env.AIHR_DB_PATH;
  delete process.env.AIHR_API_TOKEN;
});

test("first run requires storage, extension pairing, and first data action", () => {
  assert.equal(nextOnboardingStep({}), "storage");
  assert.equal(nextOnboardingStep({ storage: true }), "extension");
  assert.equal(nextOnboardingStep({ storage: true, extension: true }), "first-data");
  assert.equal(
    nextOnboardingStep({ storage: true, extension: true, firstData: true }),
    "complete"
  );
});

test("desktop settings keep models disabled and close-to-tray enabled by default", () => {
  assert.deepEqual(normalizeDesktopSettings({}), {
    closeToTray: true,
    backgroundCapture: true,
    knowledgeProcessing: true,
    embeddingProvider: "disabled",
    embeddingModel: "",
    embeddingBaseUrl: "",
    embeddingApiKey: "",
    knowledgeModelEnabled: false,
    knowledgeModel: "",
    knowledgeBaseUrl: "",
    knowledgeApiKey: ""
  });
});

test("desktop routes and extension bridge expose pairing without fixed UI port", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8")
  );
  const content = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
  const route = fs.readFileSync(
    new URL("../src/app/api/desktop/status/route.ts", import.meta.url),
    "utf8"
  );

  assert.ok(manifest.content_scripts[0].matches.includes("http://127.0.0.1/*"));
  assert.match(content, /AIHR_WEB_PAIR_TOKEN/);
  assert.match(route, /requireApiToken/);
  assert.match(route, /pairingToken/);
});

test("desktop status persists onboarding and round-trips a validated backup", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihr-desktop-status-"));
  process.env.AIHR_DB_PATH = path.join(dataDir, "history.sqlite");
  process.env.AIHR_API_TOKEN = "desktop-test-token";

  const unauthorized = await desktopRoute.GET(
    new Request("http://127.0.0.1:32145/api/desktop/status")
  );
  const initial = await desktopRoute.GET(desktopRequest());
  const completed = await desktopRoute.POST(
    desktopRequest("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete-step", step: "storage" })
    })
  );
  const backup = await desktopRoute.GET(desktopRequest("?download=backup"));
  const backupBytes = await backup.arrayBuffer();

  const invalidForm = new FormData();
  invalidForm.set("database", new File(["not sqlite"], "invalid.sqlite"));
  const invalid = await desktopRoute.POST(desktopRequest("", { method: "POST", body: invalidForm }));

  const validForm = new FormData();
  validForm.set("database", new File([backupBytes], "backup.sqlite"));
  const restored = await desktopRoute.POST(desktopRequest("", { method: "POST", body: validForm }));

  assert.equal(unauthorized.status, 401);
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).settings.embeddingProvider, "disabled");
  assert.equal((await completed.json()).onboarding.storage, true);
  assert.equal(backup.headers.get("content-type"), "application/vnd.sqlite3");
  assert.ok(backupBytes.byteLength > 0);
  assert.equal(invalid.status, 400);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).restored, true);
});
