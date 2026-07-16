# Knowledge Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically turn imported and captured conversations into deterministic summaries, generated tags, key points, and similar-conversation links without requiring a model.

**Architecture:** A SQLite job queue uses fingerprints and leases for restart-safe processing. The default processor is deterministic and uses the existing offline semantic vectorizer; a separately configured generative model may enhance structured output but never blocks valid local results. Browser mode processes bounded heartbeat batches, while the desktop daemon continuously consumes the same queue.

**Tech Stack:** TypeScript, SQLite, better-sqlite3, Next.js App Router, Node test runner

## Global Constraints

- No embedding or generative model is enabled, started, or called by default.
- Gemma 4 may enhance summaries/tags but is never used as an embedding model.
- Automatic tags remain separate from manual/imported tags.
- Imported or authored summaries are never overwritten.
- Jobs are deduplicated by conversation, task type, and content fingerprint.
- Default processing is deterministic, bounded, and single-concurrency.

---

## File Map

- `src/services/knowledge-queue-service.ts`: enqueue, claim, lease, retry, and completion transitions.
- `src/services/knowledge-rule-service.ts`: deterministic summary, tags, and key points.
- `src/services/knowledge-model-service.ts`: optional validated generative enhancement.
- `src/services/similarity-service.ts`: conversation vectors and ranked edges.
- `src/services/knowledge-worker-service.ts`: orchestration and batch processing.
- `src/components/KnowledgePanel.tsx`: per-conversation generated knowledge.
- `src/components/KnowledgeManagementPanel.tsx`: library queue status and batch controls.

### Task 1: Add Knowledge Schema And Queue State Machine

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/lib/db.ts`
- Create: `src/services/knowledge-queue-service.ts`
- Test: `test/knowledge-queue.test.mjs`

**Interfaces:**
- Produces: `enqueueKnowledgeJob`, `claimKnowledgeJobs`, `completeKnowledgeJob`, `failKnowledgeJob`, and `getKnowledgeQueueStatus`.
- Consumes: `getDb()` and `nowIso()`.

- [ ] **Step 1: Write failing queue tests**

```js
test("enqueue deduplicates the same fingerprint", () => {
  enqueueKnowledgeJob("conversation-1", "process", "hash-1");
  enqueueKnowledgeJob("conversation-1", "process", "hash-1");
  assert.equal(getKnowledgeQueueStatus().pending, 1);
});

test("expired running lease is claimable after restart", () => {
  const [first] = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:00:00.000Z" });
  const [reclaimed] = claimKnowledgeJobs({ limit: 1, now: "2026-01-01T00:06:00.000Z" });
  assert.equal(reclaimed.id, first.id);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/knowledge-queue.test.mjs`

Expected: FAIL because the queue service and tables are absent.

- [ ] **Step 3: Add additive tables**

Create `knowledge_jobs`, `conversation_insights`, `auto_conversation_tags`, and `conversation_similarities`. Use status checks, foreign keys with cascade, a unique job fingerprint index, claim indexes, and normalized similarity pairs where `left_conversation_id < right_conversation_id`.

- [ ] **Step 4: Implement transactional transitions**

```ts
export interface ClaimOptions { limit: number; now?: string; leaseSeconds?: number }
export function claimKnowledgeJobs(options: ClaimOptions): KnowledgeJob[];
export function failKnowledgeJob(id: string, error: unknown, now?: string): void;
```

Claims set a five-minute lease. Failures retry after `min(6 hours, 2 ** attempts minutes)` and become terminal after five attempts. A newer fingerprint marks obsolete pending jobs completed with reason `superseded`.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/knowledge-queue.test.mjs test/conversation-management.test.mjs`

Expected: all selected tests pass.

```bash
git add src/db/schema.sql src/lib/db.ts src/services/knowledge-queue-service.ts test/knowledge-queue.test.mjs
git commit -m "feat: add persistent knowledge queue"
```

### Task 2: Enqueue Knowledge Work From Import And Capture

**Files:**
- Modify: `src/services/import-service.ts`
- Modify: `src/services/conversation-service.ts`
- Test: `test/import-service.test.mjs`
- Test: `test/knowledge-queue.test.mjs`

**Interfaces:**
- Consumes: `enqueueKnowledgeJob(conversationId, "process", fingerprint)`.
- Produces: `knowledgeContentFingerprint(conversation)` and automatic enqueue after new/appended messages.

- [ ] **Step 1: Add failing integration assertions**

```js
test("new import enqueues one knowledge job after indexing", () => {
  persistConversations([fixture], "fixture.json", "generic-json");
  assert.equal(getKnowledgeQueueStatus().pending, 1);
});

test("duplicate import with no new messages does not enqueue again", () => {
  persistConversations([fixture], "fixture.json", "generic-json");
  persistConversations([fixture], "fixture.json", "generic-json");
  assert.equal(getKnowledgeQueueStatus().pending, 1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/import-service.test.mjs test/knowledge-queue.test.mjs`

Expected: FAIL because imports do not enqueue knowledge jobs.

- [ ] **Step 3: Add stable fingerprints inside existing transactions**

Hash normalized title plus ordered role/content pairs and processor version. Enqueue only after messages, FTS, and semantic rows have been written. Appended capture messages produce a new fingerprint; metadata-only edits do not.

- [ ] **Step 4: Cascade cleanup**

Conversation deletion relies on foreign keys for jobs, insights, automatic tags, and similarities. Extend deletion tests to assert all generated rows are removed.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/import-service.test.mjs test/conversation-management.test.mjs test/knowledge-queue.test.mjs`

Expected: all selected tests pass.

```bash
git add src/services/import-service.ts src/services/conversation-service.ts test/import-service.test.mjs test/conversation-management.test.mjs test/knowledge-queue.test.mjs
git commit -m "feat: enqueue imported conversations for knowledge processing"
```

### Task 3: Implement Deterministic Summary, Tags, And Key Points

**Files:**
- Create: `src/services/knowledge-rule-service.ts`
- Test: `test/knowledge-rule-service.test.mjs`

**Interfaces:**
- Produces: `generateRuleInsight(input): GeneratedInsight`.
- Consumes: normalized `ConversationWithMessages`.

- [ ] **Step 1: Write failing deterministic behavior tests**

```js
test("rule insight captures the problem and final conclusion", () => {
  const result = generateRuleInsight(conversationFixture);
  assert.match(result.summary, /语义搜索/);
  assert.ok(result.summary.length <= 220);
  assert.ok(result.keyPoints.length <= 5);
});

test("rule tags are bounded, normalized, and deterministic", () => {
  const first = generateRuleInsight(conversationFixture);
  const second = generateRuleInsight(conversationFixture);
  assert.deepEqual(first, second);
  assert.ok(first.tags.length <= 8);
  assert.equal(new Set(first.tags).size, first.tags.length);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/knowledge-rule-service.test.mjs`

Expected: FAIL because the rule service is absent.

- [ ] **Step 3: Implement bounded extraction**

```ts
export interface GeneratedInsight {
  summary: string;
  keyPoints: string[];
  tags: string[];
  generator: "rule" | "model";
  generatorVersion: string;
}
```

Select the first substantive user message, score assistant paragraphs for conclusion markers and information density, and combine them within 220 characters. Generate up to five points and eight tags from a controlled bilingual domain dictionary, platform, code-language signals, and repeated high-information phrases. Remove secrets matching token/key patterns from generated text.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/knowledge-rule-service.test.mjs`

Expected: all tests pass.

```bash
git add src/services/knowledge-rule-service.ts test/knowledge-rule-service.test.mjs
git commit -m "feat: generate local conversation insights"
```

### Task 4: Add Similar Conversation Ranking

**Files:**
- Create: `src/services/similarity-service.ts`
- Modify: `src/services/semantic-index-service.ts`
- Test: `test/similarity-service.test.mjs`

**Interfaces:**
- Consumes: `createSemanticVector(title, content)` and generated tags.
- Produces: `replaceSimilarConversations(conversationId, fingerprint)` and `getSimilarConversations(conversationId, limit)`.

- [ ] **Step 1: Write failing ranking tests**

```js
test("semantic peer ranks above an unrelated conversation", () => {
  seedConversations([semanticSearch, vectorRecall, cooking]);
  replaceSimilarConversations(semanticSearch.id, "hash-1");
  assert.equal(getSimilarConversations(semanticSearch.id, 2)[0].conversationId, vectorRecall.id);
});

test("reprocessing replaces stale edges", () => {
  replaceSimilarConversations("a", "old");
  replaceSimilarConversations("a", "new");
  assert.ok(getSimilarConversations("a", 10).every((edge) => edge.fingerprint === "new"));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/similarity-service.test.mjs`

Expected: FAIL because the similarity service is absent.

- [ ] **Step 3: Implement conversation-level scoring**

Build one local vector from title plus bounded user/assistant content. Score candidates as `0.70 * cosine + 0.20 * tagJaccard + 0.10 * keywordJaccard`; require a final score of at least `0.28`; store at most eight edges. Compare only vectors with the same model and dimensions.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/similarity-service.test.mjs test/search-service.test.mjs`

Expected: all selected tests pass.

```bash
git add src/services/similarity-service.ts src/services/semantic-index-service.ts test/similarity-service.test.mjs
git commit -m "feat: rank similar conversations"
```

### Task 5: Add Optional Generative Enhancement And Worker

**Files:**
- Create: `src/services/knowledge-model-service.ts`
- Create: `src/services/knowledge-worker-service.ts`
- Create: `src/app/api/knowledge/process/route.ts`
- Create: `src/app/api/knowledge/status/route.ts`
- Modify: `.env.example`
- Test: `test/knowledge-worker.test.mjs`

**Interfaces:**
- Consumes: queue, rules, similarity, and optional `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
- Produces: `processKnowledgeBatch({ limit }): KnowledgeBatchResult` and authenticated process/status routes.

- [ ] **Step 1: Write failing fallback and atomicity tests**

```js
test("model timeout keeps rule output and completes the job", async () => {
  const result = await processKnowledgeBatch({ limit: 1, enhance: () => { throw new Error("timeout"); } });
  assert.equal(result.completed, 1);
  assert.equal(getInsight("conversation-1").generator, "rule");
});

test("worker writes insight tags and similarities atomically", async () => {
  await processKnowledgeBatch({ limit: 1 });
  assert.ok(getInsight("conversation-1"));
  assert.ok(getAutoTags("conversation-1").length > 0);
  assert.equal(getKnowledgeQueueStatus().running, 0);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/knowledge-worker.test.mjs`

Expected: FAIL because worker/model services are absent.

- [ ] **Step 3: Implement validated optional enhancement**

Only call a model when `AIHR_KNOWLEDGE_MODEL_ENABLED=true` and `LLM_BASE_URL`, `LLM_MODEL`, and any endpoint-required key are present. Request strict JSON with `summary`, `keyPoints`, and `tags`; validate types and bounds; merge only valid fields with the rule result. Use Gemma 4 only through a generative chat endpoint. Document `AIHR_KNOWLEDGE_MODEL_ENABLED=` as blank in `.env.example`.

- [ ] **Step 4: Implement single-batch worker and routes**

The worker claims at most the requested limit, processes sequentially, commits each conversation atomically, and records model degradation separately from job failure. Routes enforce API auth; `POST /api/knowledge/process` caps limit at 10.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/knowledge-worker.test.mjs test/api-route-auth.test.mjs`

Expected: all selected tests pass.

```bash
git add src/services/knowledge-model-service.ts src/services/knowledge-worker-service.ts src/app/api/knowledge .env.example test/knowledge-worker.test.mjs test/api-route-auth.test.mjs
git commit -m "feat: process knowledge jobs with local fallback"
```

### Task 6: Expose Generated Knowledge In The UI

**Files:**
- Create: `src/components/KnowledgePanel.tsx`
- Create: `src/components/KnowledgeHeartbeat.tsx`
- Create: `src/components/KnowledgeManagementPanel.tsx`
- Modify: `src/services/conversation-service.ts`
- Modify: `src/app/conversations/[id]/page.tsx`
- Modify: `src/components/ConversationManagementPanel.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Test: `test/ui-workspace.test.mjs`
- Test: `test/conversation-management.test.mjs`

**Interfaces:**
- Consumes: insight, automatic tags, similar conversations, and knowledge process/status APIs.
- Produces: generated knowledge detail panel, bounded browser heartbeat, and library processing controls.

- [ ] **Step 1: Add failing service/UI tests**

```js
test("conversation read separates manual and automatic tags", () => {
  const conversation = getConversation("conversation-1");
  assert.deepEqual(conversation.manualTags, ["manual"]);
  assert.deepEqual(conversation.autoTags, ["semantic-search"]);
  assert.deepEqual(conversation.tags.sort(), ["manual", "semantic-search"]);
});
```

Add source assertions that detail UI contains generated summary, key points, automatic tag markers, and similar conversation links.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/conversation-management.test.mjs test/ui-workspace.test.mjs`

Expected: FAIL because generated fields/components are absent.

- [ ] **Step 3: Extend conversation reads and detail UI**

Return `manualTags`, `autoTags`, combined `tags`, `insight`, and `similarConversations`. Display explicit summary before generated fallback, mark automatic tags, and keep similar rows compact and navigable.

- [ ] **Step 4: Add bounded browser heartbeat**

While a browser page is visible, call the process route no more than once per 60 seconds, request at most two jobs, stop when the queue is empty, and suspend when `document.visibilityState !== "visible"`.

- [ ] **Step 5: Run milestone verification and commit**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: all tests pass, lint and TypeScript exit 0, and production build exits 0.

```bash
git add src/components/KnowledgePanel.tsx src/components/KnowledgeHeartbeat.tsx src/components/KnowledgeManagementPanel.tsx src/services/conversation-service.ts src/app/conversations/'[id]'/page.tsx src/components/ConversationManagementPanel.tsx src/app/layout.tsx src/app/globals.css test
git commit -m "feat: surface generated conversation knowledge"
```
