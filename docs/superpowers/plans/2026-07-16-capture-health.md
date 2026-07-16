# Capture Modularization And Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Chrome capture implementation into testable core/platform modules and expose evidence-based application, extension, and platform health checks.

**Architecture:** Preserve Manifest V3 plain JavaScript loading while moving platform extraction into independent global modules loaded before the coordinator. Shared core modules own storage, scheduling, API transport, and protocol validation. The Next.js health service aggregates database, index, capture, queue, and optional-model checks without exposing private content.

**Tech Stack:** Chrome Manifest V3, JavaScript, TypeScript, Next.js App Router, SQLite, Node test runner

## Global Constraints

- Keep ChatGPT, Gemini, DeepSeek, and Qwen capture behavior working throughout the refactor.
- The extension and local APIs bind to loopback only and keep existing shared-token enforcement.
- Unknown bridge messages and incompatible protocol versions are rejected.
- A failed platform adapter cannot stop another platform adapter.
- Optional models report `disabled` when unconfigured and do not degrade overall health.
- Do not introduce a bundler into the extension in this milestone.

---

## File Map

- `extension/core/constants.js`: versions, endpoint candidates, timing limits, and platform URLs.
- `extension/core/api-client.js`: endpoint probing, token headers, and JSON transport.
- `extension/core/chrome-api.js`: Promise wrappers around Chrome callback APIs.
- `extension/core/protocol.js`: bridge message allowlist and version compatibility.
- `extension/platforms/registry.js`: adapter registration and URL-to-adapter lookup.
- `extension/platforms/{chatgpt,gemini,deepseek,qwen}.js`: platform discovery, extraction, and diagnostics.
- `extension/content.js`: thin content coordinator and message dispatcher.
- `extension/background.js`: thin service-worker coordinator over queue/scheduler modules.
- `src/services/health-check-service.ts`: health check aggregation and report redaction.
- `src/app/api/health/route.ts`: authenticated health JSON endpoint.
- `src/app/health/page.tsx`: full diagnostic interface.

### Task 1: Define Extension Module Contracts

**Files:**
- Create: `extension/core/constants.js`
- Create: `extension/core/protocol.js`
- Create: `extension/platforms/registry.js`
- Modify: `extension/manifest.json`
- Test: `test/extension-modules.test.mjs`

**Interfaces:**
- Produces: `globalThis.AIHR_CONSTANTS`, `globalThis.AIHR_PROTOCOL.validate(message)`, and `globalThis.AIHR_PLATFORMS.register(adapter)`.
- Consumes: existing extension version `0.1.42` and current message names.

- [ ] **Step 1: Write the failing contract tests**

```js
test("platform registry selects one adapter by URL", () => {
  const context = loadExtensionScripts(["extension/platforms/registry.js"]);
  context.AIHR_PLATFORMS.register({ id: "chatgpt", matches: (url) => url.includes("chatgpt.com") });
  assert.equal(context.AIHR_PLATFORMS.forUrl("https://chatgpt.com/c/1").id, "chatgpt");
});

test("bridge protocol rejects unknown and incompatible messages", () => {
  const context = loadExtensionScripts(["extension/core/constants.js", "extension/core/protocol.js"]);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "UNKNOWN" }).ok, false);
  assert.equal(context.AIHR_PROTOCOL.validate({ type: "AIHR_WEB_GET_STATUS", protocolVersion: 999 }).ok, false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/extension-modules.test.mjs`

Expected: FAIL because the three extension modules do not exist.

- [ ] **Step 3: Implement the minimal globals**

```js
globalThis.AIHR_CONSTANTS = Object.freeze({
  extensionVersion: "0.1.43",
  protocolVersion: 1,
  endpointCandidates: ["http://127.0.0.1:32145", "http://127.0.0.1:3000"]
});
```

The registry must reject duplicate IDs and adapters missing `matches`, `discover`, `extract`, or `diagnostics`. The protocol must allow the existing `AIHR_WEB_*` and `AIHR_CONTENT_*` message families explicitly.

- [ ] **Step 4: Load content modules before the content coordinator**

Update `content_scripts[].js` to load constants, protocol, registry, four platform adapters, `incremental-sync.js`, then `content.js`. Keep the existing background service worker unchanged in this task so every intermediate commit remains loadable; Task 3 switches it when `background-entry.js` and its imported worker modules exist.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/extension-modules.test.mjs test/extension-bridge.test.mjs test/extension-safety.test.mjs`

Expected: all selected tests pass.

```bash
git add extension/core extension/platforms/registry.js extension/manifest.json test/extension-modules.test.mjs
git commit -m "refactor: define extension module contracts"
```

### Task 2: Extract Platform Adapters From Content Script

**Files:**
- Create: `extension/platforms/chatgpt.js`
- Create: `extension/platforms/gemini.js`
- Create: `extension/platforms/deepseek.js`
- Create: `extension/platforms/qwen.js`
- Create: `test/fixtures/extension/*.html`
- Modify: `extension/content.js`
- Test: `test/extension-platforms.test.mjs`

**Interfaces:**
- Consumes: `AIHR_PLATFORMS.register(adapter)` from Task 1 and `AIHR_INCREMENTAL_SYNC.createTracker(options)`.
- Produces: four adapters implementing `id`, `matches`, `discover`, `extract`, and `diagnostics`.

- [ ] **Step 1: Add one fixture-based failing test per platform**

```js
for (const fixture of platformFixtures) {
  test(`${fixture.id} extracts ordered user and assistant messages`, async () => {
    const adapter = await loadPlatformFixture(fixture);
    const result = await adapter.extract();
    assert.deepEqual(result.messages.map(({ role }) => role), ["user", "assistant"]);
    assert.ok(result.messages.every(({ content }) => content.length > 0));
  });
}
```

Fixtures contain the smallest representative DOM for each platform plus one irrelevant node that must not be extracted.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/extension-platforms.test.mjs`

Expected: FAIL because platform adapter files are absent.

- [ ] **Step 3: Move platform code without changing selectors**

Each file uses an IIFE and registers exactly one adapter:

```js
(() => {
  globalThis.AIHR_PLATFORMS.register({
    id: "chatgpt",
    matches: (url) => new URL(url).hostname === "chatgpt.com",
    discover: (options) => discoverChatGptHistory(options),
    extract: () => extractChatGptConversation(),
    diagnostics: () => diagnoseChatGptPage()
  });
})();
```

Move same-origin discovery APIs, selectors, URL patterns, and Qwen step discovery into their owning adapter. Keep generic DOM cleaning in `extension/core/dom.js`.

- [ ] **Step 4: Reduce `content.js` to coordination**

`content.js` resolves `AIHR_PLATFORMS.forUrl(location.href)`, validates messages, invokes the adapter, and forwards normalized results. It must contain no platform hostnames or selectors.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/extension-platforms.test.mjs test/extension-incremental-sync.test.mjs test/extension-bridge.test.mjs`

Expected: all selected tests pass and `rg -n "chatgpt|gemini|deepseek|qwen|ds-message|chat-round" extension/content.js` returns no platform implementation matches.

```bash
git add extension/content.js extension/core/dom.js extension/platforms test/extension-platforms.test.mjs test/fixtures/extension
git commit -m "refactor: isolate extension platform adapters"
```

### Task 3: Extract Background Core And Endpoint Probing

**Files:**
- Create: `extension/background-entry.js`
- Create: `extension/core/api-client.js`
- Create: `extension/core/chrome-api.js`
- Create: `extension/core/capture-queue.js`
- Create: `extension/core/scheduler.js`
- Modify: `extension/background.js`
- Test: `test/extension-background-core.test.mjs`

**Interfaces:**
- Consumes: `AIHR_CONSTANTS.endpointCandidates` and existing Chrome storage keys.
- Produces: `AIHR_API.request(path, options)`, `AIHR_CAPTURE_QUEUE`, and `AIHR_SCHEDULER`.

- [ ] **Step 1: Write failing transport and queue recovery tests**

```js
test("API client probes desktop before development endpoint", async () => {
  const calls = [];
  const api = createApiClient({ fetch: async (url) => {
    calls.push(url);
    return { ok: calls.length === 2, json: async () => ({ ok: true }) };
  }});
  await api.request("/api/health");
  assert.deepEqual(calls.map((url) => new URL(url).port), ["32145", "3000"]);
});

test("queue restores a running target as pending after lease expiry", async () => {
  const queue = createQueue(memoryStorage({ status: "running", leaseUntil: 1 }));
  assert.equal((await queue.restore(2)).status, "pending");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/extension-background-core.test.mjs`

Expected: FAIL because core modules do not exist.

- [ ] **Step 3: Extract wrappers and state machines**

Move callback-to-Promise Chrome wrappers into `chrome-api.js`, fetch/token/endpoint behavior into `api-client.js`, persisted queue transitions into `capture-queue.js`, and alarm setup/backoff into `scheduler.js`. Inject `chrome`, `fetch`, time, and randomness into factory functions for tests.

- [ ] **Step 4: Make the service worker a coordinator**

`background-entry.js` imports modules and `background.js`. Switch `manifest.json` to this service worker in the same change. The coordinator wires commands to queue and scheduler methods and retains no direct `chrome.storage`, `chrome.alarms`, or raw local endpoint constants.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/extension-background-core.test.mjs test/extension-safety.test.mjs test/extension-incremental-sync.test.mjs`

Expected: all selected tests pass.

```bash
git add extension/background-entry.js extension/background.js extension/core extension/manifest.json test/extension-background-core.test.mjs
git commit -m "refactor: split extension background core"
```

### Task 4: Add Health Service And Redacted Diagnostics

**Files:**
- Create: `src/services/health-check-service.ts`
- Create: `src/app/api/health/route.ts`
- Modify: `src/db/schema.sql`
- Modify: `src/lib/db.ts`
- Test: `test/health-check-service.test.mjs`
- Test: `test/api-route-auth.test.mjs`

**Interfaces:**
- Produces: `getHealthReport(): HealthReport` and `redactHealthReport(report): HealthReport`.
- Consumes: `getDb()`, `getEmbeddingConfig()`, capture audit, and platform sync state.

- [ ] **Step 1: Write failing aggregation tests**

```js
test("disabled optional model is healthy-neutral", () => {
  const report = aggregateHealth([{ id: "model", status: "disabled" }]);
  assert.equal(report.status, "healthy");
});

test("diagnostic report removes secrets, content, and absolute paths", () => {
  const output = JSON.stringify(redactHealthReport(secretFixture));
  assert.doesNotMatch(output, /token-value|conversation text|\/Users\//);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/health-check-service.test.mjs`

Expected: FAIL because the health service does not exist.

- [ ] **Step 3: Implement typed checks**

```ts
export type HealthStatus = "healthy" | "degraded" | "unavailable" | "disabled";
export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  evidence: string;
  action?: { label: string; href: string };
}
```

Add checks for SQLite quick-check/write transaction, schema version, FTS count, semantic coverage, disk availability, capture evidence, extension metadata, and optional model configuration. Add `health_check_runs` for explicit and status-changing snapshots with a retention cap of 100 rows; routine polling never inserts a row. Health reads must not call a configured model; model connectivity is an explicit user-triggered check.

- [ ] **Step 4: Add authenticated route**

`GET /api/health` returns the redacted report and uses the existing API authorization helper. Add route auth coverage to `test/api-route-auth.test.mjs`.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/health-check-service.test.mjs test/api-route-auth.test.mjs`

Expected: all selected tests pass.

```bash
git add src/services/health-check-service.ts src/app/api/health/route.ts src/db/schema.sql src/lib/db.ts test/health-check-service.test.mjs test/api-route-auth.test.mjs
git commit -m "feat: add local health diagnostics"
```

### Task 5: Add Health Page And Extension Status UI

**Files:**
- Create: `src/app/health/page.tsx`
- Create: `src/components/HealthDashboard.tsx`
- Modify: `src/components/AppNavigation.tsx`
- Modify: `src/app/page.tsx`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `src/app/globals.css`
- Test: `test/ui-workspace.test.mjs`

**Interfaces:**
- Consumes: `GET /api/health` and `HealthReport` from Task 4.
- Produces: `/health`, compact home/navigation status, and extension popup health summary.

- [ ] **Step 1: Add failing UI source assertions**

```js
test("health workspace exposes evidence and repair actions", async () => {
  const page = await source("src/components/HealthDashboard.tsx");
  assert.match(page, /evidence/);
  assert.match(page, /复制诊断报告/);
  assert.match(page, /修复/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/ui-workspace.test.mjs`

Expected: FAIL because `HealthDashboard.tsx` is absent.

- [ ] **Step 3: Implement the diagnostic workspace**

Render one unframed status band and grouped check rows. Use Lucide status/action icons, reserve cards for repeated checks, and provide Refresh and Copy report commands. The home page shows only the aggregate status and a link.

- [ ] **Step 4: Add popup status**

Popup startup calls the endpoint-probing API client, shows local service plus current adapter diagnostics, and leaves existing capture commands intact.

- [ ] **Step 5: Run milestone verification and commit**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: all tests pass, lint and TypeScript exit 0, and the production build exits 0.

```bash
git add src/app/health src/components/HealthDashboard.tsx src/components/AppNavigation.tsx src/app/page.tsx src/app/globals.css extension/popup.html extension/popup.js test/ui-workspace.test.mjs
git commit -m "feat: expose capture health workspace"
```
