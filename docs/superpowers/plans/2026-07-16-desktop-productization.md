# Desktop Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship installable macOS and Windows desktop builds that run quietly in the tray, preserve extension/background functionality, and release UI resources when no window is open.

**Architecture:** Tauri 2 supervises a packaged Node runtime. A lightweight daemon stays resident for extension ingestion, health, and knowledge work; the Next.js standalone UI starts on demand and stops when the WebView closes. SQLite remains in the operating-system application data directory and both processes reuse existing application services.

**Tech Stack:** Tauri 2, Rust, Node.js runtime sidecar, Next.js standalone, SQLite, GitHub Actions

## Global Constraints

- Support macOS and Windows installers.
- Launch-at-login starts in the tray without opening a window.
- Closing the window destroys its WebView and stops the Next UI sidecar.
- Tray-only idle target: average CPU below 0.5% over five minutes and resident memory at or below 120 MB.
- No database wake-up more frequently than once per minute while fully idle.
- Optional local model processes are excluded from the budget and are never started by the application.
- Signing, notarization, and remote updates remain out of scope without release credentials/design.

---

## File Map

- `desktop/daemon-entry.ts`: lightweight loopback API and knowledge worker scheduler.
- `desktop/ui-entry.mjs`: starts/stops Next standalone on an assigned loopback port.
- `scripts/prepare-desktop-sidecar.mjs`: packages Node runtime and desktop resources for the current target.
- `src-tauri/src/{lib,lifecycle,tray,sidecars}.rs`: native lifecycle and tray supervision.
- `src-tauri/tauri.conf.json`: bundle, resources, external binary, and installer config.
- `src/app/onboarding/page.tsx`: first-run setup.
- `src/app/settings/page.tsx`: desktop and model settings.
- `.github/workflows/desktop-build.yml`: native macOS/Windows builds.

### Task 1: Create The Lightweight Desktop Daemon

**Files:**
- Create: `desktop/daemon-entry.ts`
- Create: `desktop/daemon-router.ts`
- Create: `desktop/runtime-config.ts`
- Modify: `src/app/api/extension/capture-page/route.ts`
- Create: `src/services/extension-capture-service.ts`
- Test: `test/desktop-daemon.test.mjs`

**Interfaces:**
- Produces: `startDaemon({ host, port, token, dbPath, dataDir })` and a reusable `captureExtensionPayload(payload)` service.
- Consumes: health service and knowledge worker from previous plans.

- [ ] **Step 1: Write failing daemon routing tests**

```js
test("daemon rejects non-loopback bind addresses", async () => {
  await assert.rejects(() => startDaemon({ host: "0.0.0.0", port: 32145 }), /loopback/);
});

test("daemon requires pairing token for extension writes", async () => {
  const response = await requestDaemon("POST", "/api/extension/capture-page", { token: "wrong" });
  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/desktop-daemon.test.mjs`

Expected: FAIL because desktop daemon modules are absent.

- [ ] **Step 3: Extract capture route business logic**

Move request-independent validation/import logic from the Next route into `captureExtensionPayload`. Both the route and daemon router call this service; HTTP authorization remains in their respective adapters.

- [ ] **Step 4: Implement a minimal native HTTP router**

Support only `/api/health`, extension capture/discovery/filter/sync endpoints, knowledge status/process, `/ready`, and `/shutdown`. Enforce loopback remote addresses, constant-time token comparison, JSON body limits, method allowlists, and request timeouts. Do not embed Next.js in the daemon.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/desktop-daemon.test.mjs test/api-security.test.mjs test/extension-bridge.test.mjs`

Expected: all selected tests pass.

```bash
git add desktop src/services/extension-capture-service.ts src/app/api/extension/capture-page/route.ts test/desktop-daemon.test.mjs
git commit -m "feat: add lightweight desktop daemon"
```

### Task 2: Package Node Runtime And Next Standalone Resources

**Files:**
- Create: `scripts/prepare-desktop-sidecar.mjs`
- Create: `desktop/ui-entry.mjs`
- Modify: `next.config.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `test/desktop-packaging.test.mjs`

**Interfaces:**
- Consumes: `next build` standalone output and current target triple.
- Produces: `src-tauri/binaries/aihr-node-$TARGET` plus `src-tauri/resources/{daemon,ui}`.

- [ ] **Step 1: Write failing package-layout tests**

```js
test("desktop package plan contains daemon and UI entrypoints", async () => {
  const manifest = await planDesktopResources({ platform: "darwin", arch: "arm64" });
  assert.deepEqual(manifest.resources.sort(), ["daemon/daemon.mjs", "ui/server.js"]);
  assert.match(manifest.binaryName, /aarch64-apple-darwin$/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/desktop-packaging.test.mjs`

Expected: FAIL because the packaging script does not exist.

- [ ] **Step 3: Enable standalone output and bundle daemon code**

Set `output: "standalone"`. Add `desktop:prepare` that builds Next, bundles daemon TypeScript with `esbuild`, copies required `better-sqlite3` native artifacts, and copies a verified Node runtime supplied by `AIHR_DESKTOP_NODE_BINARY`. The script fails when the binary version does not match the supported Node major.

- [ ] **Step 4: Add UI launcher**

`ui-entry.mjs` selects a free loopback port, exports `AIHR_DB_PATH`, `AIHR_API_TOKEN`, and `PORT`, starts standalone `server.js`, prints one JSON readiness line, and forwards termination signals for clean shutdown.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/desktop-packaging.test.mjs && npm run build`

Expected: tests pass and Next standalone build exits 0.

```bash
git add scripts/prepare-desktop-sidecar.mjs desktop/ui-entry.mjs next.config.mjs package.json package-lock.json .gitignore test/desktop-packaging.test.mjs
git commit -m "build: prepare desktop sidecar resources"
```

### Task 3: Scaffold Tauri Lifecycle And Tray

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/sidecars.rs`
- Create: `src-tauri/src/lifecycle.rs`
- Create: `src-tauri/src/tray.rs`
- Test: `src-tauri/src/lifecycle.rs` unit tests

**Interfaces:**
- Consumes: packaged `aihr-node` sidecar and daemon/UI resource entrypoints.
- Produces: `AppRuntime` state with `ensure_daemon`, `open_main_window`, `close_main_window`, and `shutdown`.

- [ ] **Step 1: Write failing Rust lifecycle tests**

```rust
#[test]
fn closing_last_window_stops_ui_but_keeps_daemon() {
    let mut state = FakeRuntime::running();
    state.close_main_window();
    assert!(state.daemon_running());
    assert!(!state.ui_running());
}

#[test]
fn quit_stops_both_children() {
    let mut state = FakeRuntime::running();
    state.quit();
    assert!(!state.daemon_running());
    assert!(!state.ui_running());
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because the Tauri crate and lifecycle state do not exist.

- [ ] **Step 3: Implement native supervision**

Use Tauri shell sidecars from Rust, capture child handles, wait for JSON readiness with a timeout, and terminate child trees on Quit. Store token and database under `app_data_dir`; set owner-only permissions on macOS and best-effort user ACLs on Windows. A daemon port conflict produces a native recovery dialog instead of binding elsewhere silently.

- [ ] **Step 4: Implement tray and window lifecycle**

Create tray actions Open, Sync now, Pause background work, Health, and Quit. Intercept window close, destroy the WebView, stop UI, and keep daemon. Normal launch opens/focuses the window; `--autostart` remains tray-only. Enable Tauri single-instance and autostart plugins with least-privilege capabilities.

- [ ] **Step 5: Verify and commit**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

Expected: formatting, tests, and clippy pass.

```bash
git add src-tauri package.json package-lock.json
git commit -m "feat: add low-resource Tauri tray lifecycle"
```

### Task 4: Add First-Run Onboarding, Pairing, And Settings

**Files:**
- Create: `src/app/onboarding/page.tsx`
- Create: `src/components/OnboardingFlow.tsx`
- Create: `src/app/settings/page.tsx`
- Create: `src/components/DesktopSettings.tsx`
- Create: `src/app/api/desktop/status/route.ts`
- Modify: `extension/core/api-client.js`
- Modify: `extension/content.js`
- Modify: `src/components/AppNavigation.tsx`
- Modify: `src/app/globals.css`
- Test: `test/desktop-onboarding.test.mjs`

**Interfaces:**
- Consumes: daemon endpoint probing, extension bridge, health report, and Tauri autostart commands.
- Produces: three-step onboarding, one-click token pairing, and desktop settings.

- [ ] **Step 1: Write failing onboarding state tests**

```js
test("first run requires storage, extension pairing, and first data action", () => {
  assert.equal(nextOnboardingStep(emptyState), "storage");
  assert.equal(nextOnboardingStep(storageReadyState), "extension");
  assert.equal(nextOnboardingStep(pairedState), "first-data");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/desktop-onboarding.test.mjs`

Expected: FAIL because onboarding modules are absent.

- [ ] **Step 3: Implement three-step onboarding**

Show the resolved data directory without exposing it in copied diagnostics, verify database health, open Chrome extension instructions, pair through the versioned page bridge, then offer file import or first sync. Persist completion in the application data directory rather than browser local storage.

- [ ] **Step 4: Implement settings**

Expose launch at login, close-to-tray, background capture, knowledge processing, optional model configuration, backup/restore, and diagnostics. Model settings are blank/off by default. Restore validates SQLite `quick_check` and creates a rollback copy before replacement.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/desktop-onboarding.test.mjs test/extension-bridge.test.mjs test/ui-workspace.test.mjs && npx tsc --noEmit`

Expected: all selected tests and TypeScript pass.

```bash
git add src/app/onboarding src/app/settings src/app/api/desktop src/components/OnboardingFlow.tsx src/components/DesktopSettings.tsx src/components/AppNavigation.tsx src/app/globals.css extension/core/api-client.js extension/content.js test/desktop-onboarding.test.mjs
git commit -m "feat: add desktop onboarding and settings"
```

### Task 5: Add Resource Budget Measurement

**Files:**
- Create: `scripts/measure-desktop-idle.mjs`
- Create: `test/desktop-resource-budget.test.mjs`
- Modify: `src/services/health-check-service.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: daemon PID/status endpoint and platform process metrics.
- Produces: `npm run desktop:measure-idle` JSON report and health evidence.

- [ ] **Step 1: Write failing sampler tests**

```js
test("resource sampler rejects over-budget idle samples", () => {
  assert.equal(evaluateBudget({ cpuAverage: 0.7, rssMb: 90, dbWakeups: 1 }).ok, false);
});

test("resource sampler accepts the specified idle budget", () => {
  assert.equal(evaluateBudget({ cpuAverage: 0.2, rssMb: 100, dbWakeups: 3 }).ok, true);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/desktop-resource-budget.test.mjs`

Expected: FAIL because the resource measurement module is absent.

- [ ] **Step 3: Implement five-minute measurement**

Sample supervisor/daemon CPU and RSS every five seconds, count daemon-reported DB wake-ups and outbound requests, and emit a redacted JSON report. Thresholds are CPU `<0.5%`, RSS `<=120 MB`, DB wake-ups `<=5` in five fully idle minutes, and zero unconfigured outbound requests.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/desktop-resource-budget.test.mjs`

Expected: tests pass. Run the full five-minute command only with a packaged desktop development build.

```bash
git add scripts/measure-desktop-idle.mjs test/desktop-resource-budget.test.mjs src/services/health-check-service.ts package.json
git commit -m "test: enforce desktop idle resource budget"
```

### Task 6: Add Native Packaging And CI

**Files:**
- Create: `.github/workflows/desktop-build.yml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `test/desktop-packaging.test.mjs`

**Interfaces:**
- Consumes: sidecar preparation and Tauri project.
- Produces: unsigned macOS DMG and Windows NSIS/MSI development artifacts.

- [ ] **Step 1: Add failing workflow assertions**

```js
test("desktop workflow builds on native macOS and Windows runners", async () => {
  const workflow = await readWorkflow(".github/workflows/desktop-build.yml");
  assert.deepEqual(workflow.jobs.build.strategy.matrix.os.sort(), ["macos-latest", "windows-latest"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/desktop-packaging.test.mjs`

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Configure native build jobs**

Each runner installs locked Node/Rust dependencies, supplies its native Node binary to `desktop:prepare`, runs JS/Rust verification, builds Tauri, and uploads unsigned development artifacts. Windows builds on Windows because MSI tooling is native; macOS DMG builds on macOS. Do not configure signing secrets.

- [ ] **Step 4: Document installation and limitations**

Document tray behavior, extension pairing, data location, backup, unsigned installer warnings, model-off defaults, and resource measurement. Keep code signing, notarization, and update service explicitly out of scope.

- [ ] **Step 5: Run final verification and commit**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

Expected: all commands exit 0. Then run `npm run tauri build -- --bundles dmg` on macOS; Windows installer completion is verified by the native CI job.

```bash
git add .github/workflows/desktop-build.yml src-tauri/tauri.conf.json README.md .env.example test/desktop-packaging.test.mjs
git commit -m "build: package macOS and Windows desktop apps"
```

