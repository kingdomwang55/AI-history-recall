# AI History Recall Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local-first AI conversation recall MVP into a maintainable personal product with safer APIs, smaller capture modules, tested core data flows, and practical library-management features.

**Architecture:** Keep the existing Next.js App Router, SQLite/FTS5, and Chrome extension architecture. Reduce risk by first splitting the largest UI/control surface, then adding regression tests around data flows, then consolidating platform extraction logic, then shipping product capabilities in small vertical slices.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, SQLite with `better-sqlite3`, Chrome MV3 extension JavaScript, Node `node:test`, npm.

## Global Constraints

- Keep npm as the single package manager; do not reintroduce pnpm lock/workspace files.
- Keep dependencies pinned; do not add `"latest"` version ranges.
- Preserve local-first behavior; do not introduce cloud sync.
- Keep `AIHR_API_TOKEN` optional: when unset, local development remains open; when set, every `/api/*` route must require a matching token.
- Do not commit `data/`, `.env*`, `.next/`, `node_modules/`, or `extension/config.js`.
- Prefer focused, testable changes with one commit per task.
- Before each commit run: `npm test`, `npm run lint`, `npx tsc --noEmit`; before milestone completion also run `npm run build`.

---

## Roadmap Overview

| Goal | Name | Outcome | Priority |
| --- | --- | --- | --- |
| 1 | Split Capture UI | `CapturePlanner.tsx` becomes a coordinator over focused hooks/components | P0 |
| 2 | Core Regression Tests | Import, search, auth, and adapter behavior become safe to refactor | P0 |
| 3 | Shared Platform Extraction | Platform selectors/config are no longer maintained in two unrelated places | P1 |
| 4 | Library Management Features | Users can delete, reindex, and export conversations | P1 |
| 5 | Search Quality | Chinese/no-space search and ranking improve before semantic search | P2 |

---

### Task 1: Split Capture Planner State And Extension Bridge

**Files:**
- Create: `src/components/capture/useExtensionBridge.ts`
- Create: `src/components/capture/capture-types.ts`
- Modify: `src/components/CapturePlanner.tsx`
- Test: `npm test`, `npm run lint`, `npx tsc --noEmit`

**Interfaces:**
- Produces: `useExtensionBridge()` hook returning `extensionReady`, `extensionMeta`, `extensionRun`, `extensionBridgeError`, `extensionCheckedAt`, `requestExtension`, and extension action helpers.
- Consumes: existing `window.postMessage` protocol from `extension/content.js`.

- [ ] **Step 1: Move shared capture types**

Move `Platform`, `JobSummary`, `ChromeStatus`, `PlatformPreflight`, `PlatformAudit`, `CaptureAuditSummary`, and `ExtensionRunStatus` from `CapturePlanner.tsx` into `src/components/capture/capture-types.ts`.

- [ ] **Step 2: Extract extension bridge hook**

Create `useExtensionBridge` with the current message listener, status polling, reload detection, and `requestExtension<T>()` behavior. Keep the exact message protocol names:

```ts
AIHR_EXTENSION_READY
AIHR_WEB_STATUS_RESULT
AIHR_WEB_GET_STATUS
AIHR_WEB_RELOAD_EXTENSION
AIHR_WEB_START_CAPTURE
AIHR_WEB_STOP_CAPTURE
AIHR_WEB_RESUME_CAPTURE
AIHR_WEB_CLEAR_STATUS
```

- [ ] **Step 3: Replace inline bridge state in `CapturePlanner`**

Import the hook and remove duplicated state/effects from `CapturePlanner.tsx`. The parent component should call hook actions instead of directly owning `window.postMessage` plumbing.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/CapturePlanner.tsx src/components/capture
git commit -m "refactor: extract capture extension bridge"
```

**Acceptance Criteria:**
- `CapturePlanner.tsx` loses at least 200 lines.
- Extension connection, status refresh, stop/resume/clear/start still compile through typed hook methods.
- No behavior change to extension message protocol.

---

### Task 2: Split Capture Audit And Job Hooks

**Files:**
- Create: `src/components/capture/useCaptureAudit.ts`
- Create: `src/components/capture/useCaptureJobs.ts`
- Modify: `src/components/CapturePlanner.tsx`
- Test: `npm test`, `npm run lint`, `npx tsc --noEmit`

**Interfaces:**
- Produces: `useCaptureAudit()` with `audit`, `auditSummary`, `loadCaptureAudit`, `refreshAudit`, `weakEvidencePlatforms`, `missingOrWeakPlatforms`.
- Produces: `useCaptureJobs()` with `jobs`, `selectedJobId`, setters, `refreshJobs`, `createJob`, `runJobBatch`, `runJobUntilIdle`.
- Consumes: existing `/api/capture/audit` and `/api/capture/jobs` routes via `apiFetch`.

- [ ] **Step 1: Extract audit data loading**

Move audit state, audit refresh, weak-evidence helpers, and missing-platform helpers into `useCaptureAudit`.

- [ ] **Step 2: Extract job task behavior**

Move job state and job action methods into `useCaptureJobs`. Keep `batchSize`, `maxBatches`, `batchDelaySeconds`, and `maxAttempts` externally configurable by returning state/setters.

- [ ] **Step 3: Wire hooks into `CapturePlanner`**

Replace direct state/effects with hook returns. Keep UI copy unchanged.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/CapturePlanner.tsx src/components/capture
git commit -m "refactor: extract capture audit and job hooks"
```

**Acceptance Criteria:**
- `CapturePlanner.tsx` no longer directly owns audit/job fetch implementation details.
- Weak-evidence platform selection behavior remains unchanged.

---

### Task 3: Split Capture Planner UI Panels

**Files:**
- Create: `src/components/capture/CaptureGuidePanel.tsx`
- Create: `src/components/capture/CaptureStatusPanel.tsx`
- Create: `src/components/capture/CaptureAdvancedPanel.tsx`
- Modify: `src/components/CapturePlanner.tsx`
- Test: `npm test`, `npm run lint`, `npx tsc --noEmit`, manual `/capture` smoke test

**Interfaces:**
- Produces: presentational components that receive typed props and callbacks.
- Consumes: hooks from Tasks 1 and 2.

- [ ] **Step 1: Extract guide panel**

Move the top one-click guide UI, assistant message, assistant steps, extension status label, and primary guided action button into `CaptureGuidePanel`.

- [ ] **Step 2: Extract status panel**

Move extension run status, audit summary, platform audit rows, and job status display into `CaptureStatusPanel`.

- [ ] **Step 3: Extract advanced panel**

Move CDP controls, manual plan generation, browser capture, discover, agent, and job advanced controls into `CaptureAdvancedPanel`.

- [ ] **Step 4: Keep `CapturePlanner` as coordinator**

After extraction, `CapturePlanner.tsx` should primarily compose hooks and panels.

- [ ] **Step 5: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Then start:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3100
```

Open `http://127.0.0.1:3100/capture` and confirm the page renders.

- [ ] **Step 6: Commit**

```bash
git add src/components/CapturePlanner.tsx src/components/capture
git commit -m "refactor: split capture planner panels"
```

**Acceptance Criteria:**
- `CapturePlanner.tsx` is reduced below 800 lines.
- No nested-card redesign or major visual redesign is introduced.
- `/capture` still exposes the same default guide and advanced workflows.

---

### Task 4: Add Core Import And Search Tests

**Files:**
- Create: `test/import-service.test.mjs`
- Create: `test/search-service.test.mjs`
- Modify: `src/services/import-service.ts` only if dependency injection is needed for test isolation
- Modify: `src/services/search-service.ts` only if helper exports are needed
- Test: `npm test`

**Interfaces:**
- Produces: regression tests for duplicate handling, FTS insert behavior, and query normalization.
- Consumes: existing SQLite data layer.

- [ ] **Step 1: Test duplicate source URL behavior**

Create a temporary SQLite DB path via `process.env.AIHR_DB_PATH`, import the same parsed conversation twice, and assert the second import increments `skippedDuplicates` without duplicating messages.

- [ ] **Step 2: Test FTS insert after import**

Import a conversation with a distinctive phrase and assert search returns it.

- [ ] **Step 3: Test search fallback behavior**

Search for a term that should be matched through the existing search implementation and assert result shape includes `conversationId`, `title`, `snippet`, and `platform`.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add test src/services
git commit -m "test: cover import and search services"
```

**Acceptance Criteria:**
- Test DBs are temporary and never touch `data/ai-history-recall.sqlite`.
- Tests can run repeatedly without relying on local production data.

---

### Task 5: Add API Auth Route Smoke Tests

**Files:**
- Modify: `test/api-auth.test.mjs`
- Create: `test/api-route-auth.test.mjs`
- Test: `npm test`

**Interfaces:**
- Produces: tests that route handlers reject missing tokens when `AIHR_API_TOKEN` is configured.
- Consumes: `src/lib/api-auth.ts` and selected route handlers.

- [ ] **Step 1: Add route-level unauthorized test**

Import one read route, such as `src/app/api/capture/audit/route.ts`, set `process.env.AIHR_API_TOKEN = "route-secret"`, call `GET(new Request(...))`, and assert status `401`.

- [ ] **Step 2: Add route-level authorized test**

Call the same handler with `X-AIHR-API-Token: route-secret` and assert status is not `401`.

- [ ] **Step 3: Verify environment cleanup**

Reset `process.env.AIHR_API_TOKEN` after each test so tests do not leak state.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add test
git commit -m "test: cover API token enforcement"
```

**Acceptance Criteria:**
- Tests prove helper-level and route-level token enforcement.
- Tests do not require a running Next server.

---

### Task 6: Create Shared Platform Metadata For App And Extension

**Files:**
- Create: `extension/platform-config.js`
- Modify: `extension/content.js`
- Modify: `extension/background.js`
- Modify: `src/capture/platforms.ts`
- Test: `npm test`, `npm run lint`, `npx tsc --noEmit`, extension reload smoke test

**Interfaces:**
- Produces: a shared JSON-compatible platform metadata shape with `id`, `label`, `hosts`, `historyUrl`, and non-secret extraction hints.
- Consumes: existing app and extension platform logic.

- [ ] **Step 1: Extract stable metadata only**

Move platform ids, labels, hosts, and history URLs into `extension/platform-config.js` or a generated JSON file that can be consumed by the extension without bundling.

- [ ] **Step 2: Keep platform-specific extraction code local**

Do not prematurely force every DOM extraction function into a shared abstraction. Start by sharing metadata and route matching only.

- [ ] **Step 3: Update app-side config**

Make `src/capture/platforms.ts` consume the same metadata values or mirror them through a small generated module.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Then reload the unpacked extension in Chrome and confirm it still reports `0.1.38 / no-debugger-input-20260711`.

- [ ] **Step 5: Commit**

```bash
git add src/capture extension
git commit -m "refactor: share platform metadata"
```

**Acceptance Criteria:**
- Host/history URL changes only need to be made in one place.
- DOM extraction behavior remains unchanged.

---

### Task 7: Add Conversation Delete And Reindex

**Files:**
- Modify: `src/services/conversation-service.ts`
- Create: `src/services/reindex-service.ts`
- Create: `src/app/api/conversations/[id]/route.ts`
- Create: `src/app/api/search/reindex/route.ts`
- Modify: `src/app/conversations/[id]/page.tsx`
- Test: `test/conversation-management.test.mjs`

**Interfaces:**
- Produces: `deleteConversation(id: string)` and `reindexSearch()` service functions.
- Consumes: existing `conversations`, `messages`, and `search_index` tables.

- [ ] **Step 1: Add tests for delete**

Insert a conversation into a temporary DB, delete it, and assert conversation, messages, tags relation, notes, and search rows are gone.

- [ ] **Step 2: Implement delete service and route**

Add `DELETE /api/conversations/[id]` with `requireApiToken(request)`.

- [ ] **Step 3: Add tests for reindex**

Delete all `search_index` rows in a temporary DB, call `reindexSearch()`, and assert rows are rebuilt from `messages`.

- [ ] **Step 4: Implement reindex service and route**

Add `POST /api/search/reindex` with `requireApiToken(request)`.

- [ ] **Step 5: Add minimal UI controls**

Add delete on conversation detail page and a reindex control in a maintenance section. Use simple confirmation text in browser `confirm()` for now; avoid large UI redesign.

- [ ] **Step 6: Verify**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src test
git commit -m "feat: add conversation delete and reindex"
```

**Acceptance Criteria:**
- Deletes cannot leave orphaned search rows.
- Reindex can rebuild FTS from canonical message data.
- Token protection applies to both write routes.

---

### Task 8: Add Markdown And JSON Export

**Files:**
- Create: `src/services/export-service.ts`
- Create: `src/app/api/conversations/[id]/export/route.ts`
- Modify: `src/app/conversations/[id]/page.tsx`
- Test: `test/export-service.test.mjs`

**Interfaces:**
- Produces: `exportConversationMarkdown(id: string)` and `exportConversationJson(id: string)`.
- Consumes: existing conversation detail service.

- [ ] **Step 1: Add Markdown export test**

Assert exported Markdown includes title, platform/source URL, tags, note, and ordered messages.

- [ ] **Step 2: Add JSON export test**

Assert exported JSON preserves title, metadata, tags, note, and message order.

- [ ] **Step 3: Implement service and route**

Support `GET /api/conversations/[id]/export?format=markdown` and `?format=json`.

- [ ] **Step 4: Add detail-page buttons**

Add export buttons beside existing copy controls.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git add src test
git commit -m "feat: export conversations"
```

**Acceptance Criteria:**
- Export is local-only.
- Markdown output is readable without app context.
- JSON output is lossless enough for backup/reimport work.

---

### Task 9: Improve Search For Chinese And Ranking

**Files:**
- Modify: `src/services/search-service.ts`
- Modify: `src/services/import-service.ts`
- Modify: `src/db/schema.sql` only if adding auxiliary index tables
- Test: `test/search-service.test.mjs`

**Interfaces:**
- Produces: improved query normalization and optional n-gram/token helper for CJK text.
- Consumes: existing FTS5 search table.

- [ ] **Step 1: Add failing tests for Chinese no-space search**

Insert a message containing a Chinese phrase and assert searches for shorter meaningful substrings return it.

- [ ] **Step 2: Implement minimal CJK query expansion**

Add a helper that detects CJK input and uses safe FTS/LIKE fallback behavior without breaking ASCII phrase search.

- [ ] **Step 3: Add ranking tests**

Assert exact title/content matches rank above loose fallback matches where possible.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git add src test
git commit -m "feat: improve local search matching"
```

**Acceptance Criteria:**
- Existing English/URL search behavior does not regress.
- Chinese phrase search improves for common no-space queries.
- Ranking changes are deterministic in tests.

---

## Recommended Execution Order

1. Tasks 1-3: split capture UI first. This reduces the largest maintenance risk before changing behavior.
2. Tasks 4-5: add core tests. This creates a safety net for service and route changes.
3. Task 6: share platform metadata. This reduces platform maintenance drift without over-abstracting extraction.
4. Tasks 7-8: add management features. These are useful user-facing improvements once the foundation is safer.
5. Task 9: improve search quality. This touches core value and should happen after tests are strong.

## Milestone Gates

### Milestone A: Maintainable Capture Surface

Complete Tasks 1-3.

Evidence required:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

And `src/components/CapturePlanner.tsx` below 800 lines.

### Milestone B: Tested Core

Complete Tasks 4-5.

Evidence required:

```bash
npm test
```

with import, search, auth helper, and auth route tests present.

### Milestone C: Product Management Basics

Complete Tasks 7-8.

Evidence required:

```bash
npm test
npm run build
```

and manual detail-page smoke test for delete/export controls.

## Self-Review

- Spec coverage: This plan covers the user's requested next goals and the accepted Grok findings that remained after Stage A/B: capture complexity, missing tests, platform duplication, product management gaps, and search quality.
- Placeholder scan: No `TBD`, `TODO`, or vague "add tests" placeholders remain; each task names files, commands, and acceptance criteria.
- Type consistency: Hook and service names are stable across tasks; later tasks consume outputs named in earlier tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-ai-history-recall-roadmap.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended first execution target: Tasks 1-3 as Milestone A.
