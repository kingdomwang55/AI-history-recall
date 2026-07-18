import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const production = process.argv.includes("--production");

const requiredProductionEnv = [
  "APPLE_CERTIFICATE_P12_BASE64",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_DEVELOPER_ID_APPLICATION",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "WINDOWS_CODESIGN_CERT_PFX_BASE64",
  "WINDOWS_CODESIGN_CERT_PASSWORD",
  "WINDOWS_TIMESTAMP_URL",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "AIHR_UPDATE_BASE_URL"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function fileIncludes(relativePath, pattern) {
  const body = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  return typeof pattern === "string" ? body.includes(pattern) : pattern.test(body);
}

function pass(id, detail = "") {
  return { id, status: "pass", detail };
}

function fail(id, detail) {
  return { id, status: "fail", detail };
}

const checks = [];
const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");

checks.push(
  packageJson.scripts?.["desktop:build"] === "npm run desktop:prepare && tauri build"
    ? pass("desktop-build-script")
    : fail("desktop-build-script", "package.json must keep desktop:build wired through desktop:prepare.")
);

checks.push(
  packageJson.scripts?.["release:check"] === "node scripts/release-readiness-check.mjs"
    ? pass("release-check-script")
    : fail("release-check-script", "package.json must expose npm run release:check.")
);

checks.push(
  /^com\.[a-z0-9.-]+\.desktop$/.test(tauriConfig.identifier)
    ? pass("bundle-identifier", tauriConfig.identifier)
    : fail("bundle-identifier", "Tauri identifier should be a stable reverse-DNS desktop id.")
);

checks.push(
  /^\d+\.\d+\.\d+$/.test(tauriConfig.version)
    ? pass("semver-version", tauriConfig.version)
    : fail("semver-version", "Tauri version must be semver before signing or update publishing.")
);

for (const resource of ["resources/daemon", "resources/ui", "resources/extension", "resources/runtime"]) {
  checks.push(
    tauriConfig.bundle?.resources?.includes(resource)
      ? pass(`bundle-resource:${resource}`)
      : fail(`bundle-resource:${resource}`, `${resource} must be packaged into the desktop bundle.`)
  );
}

checks.push(
  exists(".github/workflows/desktop-build.yml") && fileIncludes(".github/workflows/desktop-build.yml", /macos-latest/)
    ? pass("macos-native-build")
    : fail("macos-native-build", "Desktop workflow must build macOS artifacts on a macOS runner.")
);

checks.push(
  exists(".github/workflows/desktop-build.yml") && fileIncludes(".github/workflows/desktop-build.yml", /windows-latest/)
    ? pass("windows-native-build")
    : fail("windows-native-build", "Desktop workflow must build Windows artifacts on a Windows runner.")
);

checks.push(
  exists("docs/release-readiness.md") && fileIncludes("docs/release-readiness.md", /Production Release Gates/i)
    ? pass("release-readiness-doc")
    : fail("release-readiness-doc", "docs/release-readiness.md must describe production release gates.")
);

if (production) {
  for (const name of requiredProductionEnv) {
    checks.push(process.env[name] ? pass(`env:${name}`) : fail(`env:${name}`, `${name} is required for production release.`));
  }
} else {
  checks.push(pass("production-secrets", "Skipped. Run npm run release:check -- --production to require signing/update secrets."));
}

const failures = checks.filter((item) => item.status === "fail");
const report = {
  generatedAt: new Date().toISOString(),
  production,
  ok: failures.length === 0,
  checks
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
