# AI History Recall Productization Design

Date: 2026-07-16
Status: Approved

## Objective

Turn the current local-first recall application into a maintainable and installable product through three connected deliveries:

1. Split the Chrome capture extension into stable core and platform modules, then add evidence-based health checks.
2. Add persistent background knowledge processing for summaries, automatic tags, and similar conversations.
3. Package the application for macOS and Windows with a guided first-run experience.

The product must remain useful with no model configured. Embedding and generative models are optional enhancements and are disabled by default.

## Delivery Order

The work is delivered in three milestones because each later milestone depends on the operational guarantees of the previous one:

1. Capture modularization and health checks.
2. Knowledge processing and discovery features.
3. Tauri desktop packaging and onboarding.

Each milestone must preserve the existing browser development workflow and pass the full regression suite before the next milestone begins.

## Architecture

### Application Core

The existing Next.js App Router application, SQLite database, import adapters, search services, and local APIs remain the source of truth. New capabilities live behind focused service interfaces and API routes rather than being embedded in pages or extension UI code.

### Chrome Extension

The extension is split into four layers:

- `extension/core/`: queue state, scheduling, retries, Chrome API wrappers, local API client, and common utilities.
- `extension/platforms/`: one module per platform implementing the same contract.
- `extension/bridge/`: versioned extension-to-page and extension-to-local-service messages.
- `extension/ui/`: popup rendering and commands without capture logic.

Each platform module implements:

```ts
interface CapturePlatformAdapter {
  id: string;
  matches(url: string): boolean;
  discover(options: DiscoveryOptions): Promise<DiscoveryResult>;
  extract(): Promise<ExtractedConversation>;
  diagnostics(): Promise<PlatformDiagnostics>;
}
```

The first adapters are ChatGPT, Gemini, DeepSeek, and Qwen. Platform DOM and same-origin API details must not leak into queue or scheduling code. The bridge accepts only known message types and compatible protocol versions.

### Knowledge Worker

Knowledge processing is a persistent SQLite-backed queue. Import and capture transactions enqueue work by conversation content fingerprint after messages and search indexes are updated. A worker claims jobs in small batches and writes results atomically.

The desktop sidecar continuously runs the worker. Browser development mode uses a throttled application heartbeat to process small batches, so both modes share queue semantics and restart recovery.

### Desktop Shell

Tauri 2 provides the native shell, single-instance behavior, tray lifecycle, and macOS/Windows packaging. A bundled Next.js standalone server runs as a managed sidecar and retains the existing Node.js and `better-sqlite3` implementation.

The desktop service binds only to a fixed loopback port reserved by the application and performs an explicit conflict check. The extension probes the desktop endpoint first and the development endpoint second. A generated local API token pairs the desktop application and extension without requiring users to edit a file.

## Data Model

### Knowledge Jobs

`knowledge_jobs` stores:

- job ID and conversation ID;
- task type and content fingerprint;
- `pending`, `running`, `completed`, or `failed` status;
- attempts, next retry time, last error, and timestamps;
- a uniqueness constraint over conversation, task type, and fingerprint.

Interrupted `running` jobs become claimable after a lease expires. Retries use bounded exponential backoff. A changed conversation creates a new fingerprint and supersedes obsolete pending work.

### Conversation Insights

`conversation_insights` stores the generated summary, structured key points, generator type, optional model name, input fingerprint, and timestamps. Generated summaries never overwrite an imported or explicitly authored summary. The detail page displays the explicit summary first and the generated summary as the fallback.

### Automatic Tags

`auto_conversation_tags` stores generated tag relationships separately from existing manual/imported tags. Metadata editing only replaces manual tags. Reads may return the union, while the interface marks generated tags so users understand their origin.

### Similar Conversations

`conversation_similarities` stores normalized conversation pairs, score, scoring signals, fingerprints, and calculation time. Each conversation exposes a small top-ranked set. Reprocessing removes stale edges before inserting the new set.

### Health History

`health_check_runs` stores only explicit or significant diagnostic snapshots. Routine polling is computed live and is not persisted, preventing unbounded diagnostic data growth.

## Knowledge Generation

### Default Rule-Based Processing

The default processor requires no model and performs:

- summary extraction from the first substantive user problem and the strongest concluding assistant passage;
- controlled tags from platform, domain vocabulary, code/format signals, and high-information phrases;
- key point extraction from substantive user and assistant turns;
- conversation-level local semantic vector generation using the built-in offline vectorizer;
- similar-conversation ranking from semantic similarity, keyword overlap, and tag overlap.

Outputs are deterministic for the same processor version and input fingerprint. Generated text and tag counts are bounded to keep the interface scannable.

### Optional Gemma 4 Enhancement

When an OpenAI-compatible or Ollama generative endpoint is explicitly configured, Gemma 4 may improve summaries, key points, and tags. It is not used as an embedding model. Model output is schema-validated, length-limited, and treated as an enhancement to the rule result. Timeout, malformed output, or model unavailability preserves the local result and records a degraded health signal rather than failing the job permanently.

No generative or embedding model is started or called by default.

## Health Checks

Health checks use `healthy`, `degraded`, and `unavailable` states and include evidence plus an actionable remediation where possible.

Checks cover:

- application: database writeability, schema version, FTS integrity, semantic index coverage, and available disk space;
- knowledge worker: pending count, oldest job age, failed jobs, lease recovery, and recent heartbeat;
- extension: connection, extension version, bridge protocol, alarms, queue persistence, and local-service pairing;
- platforms: page availability, recent discovery/capture evidence, valid extraction output, failure streak, and backoff;
- optional models: checked only when configured; disabled models are reported as disabled, not unhealthy;
- desktop: sidecar process, loopback port, application data directory, log directory, and backup destination.

The `/health` page shows the overall state, component evidence, repair actions, and a copyable redacted diagnostic report. The home page shows only a compact status entry. The extension popup displays local service and current-platform health.

## User Experience

### Knowledge Features

Newly imported or captured conversations show a visible processing state without blocking import. Conversation details display generated summary, generated tags, key points, and similar conversations. Users can retry or regenerate failed/stale knowledge jobs. A management view supports processing the existing library in bounded batches.

### First Run

Desktop onboarding has three steps:

1. Confirm the application data location and database readiness.
2. Install and pair the Chrome extension.
3. Import a file or run the first platform sync.

The application provides a bundled unpacked extension directory and opens the correct browser instructions. Chrome policy prevents silent unpacked-extension installation, so this step remains guided rather than pretending to be automatic.

### Settings And Lifecycle

Settings cover launch at login, tray/background behavior, capture scheduling, knowledge processing, optional model configuration, data backup/restore, and diagnostics. Closing the main window may leave the application in the tray; choosing Quit stops the worker and sidecar cleanly.

## Security And Privacy

- All application and extension endpoints bind to loopback only.
- Desktop setup creates a random local API token stored with owner-only permissions where supported.
- Extension pairing writes the token to `chrome.storage.local`; diagnostic exports redact it.
- Model endpoints are never contacted unless explicitly configured.
- Existing source validation, API authorization, and database file permissions remain enforced.
- Health checks must not include conversation content, cookies, API keys, or full local paths in copyable reports.

## Error Handling

- Database migrations are additive and transactionally applied where SQLite permits.
- Queue jobs use leases, bounded retries, and explicit terminal errors.
- A failed platform adapter cannot stop other platform adapters.
- A failed optional model falls back to valid rule-based results.
- Sidecar startup failures and port conflicts produce a recovery screen with logs and retry actions.
- Extension protocol mismatches produce an upgrade instruction instead of sending capture commands.
- Backup restore validates the SQLite file before replacing the active database and preserves a rollback copy.

## Packaging

Build tooling produces:

- a macOS application and DMG;
- a Windows installer;
- a packaged Chrome extension directory;
- platform-specific Next.js standalone sidecar resources.

CI contains separate macOS and Windows jobs. Unsigned development artifacts are supported and documented. Code signing, notarization, and a remote auto-update service require external credentials and are intentionally not enabled in this delivery; update hooks may be prepared without embedding secrets.

## Testing And Acceptance

### Automated Tests

- extension platform adapter contract and fixture extraction tests;
- queue deduplication, leasing, retry, stale-job, and restart recovery tests;
- deterministic summary/tag tests and optional-model fallback tests;
- similar-conversation ranking and stale-edge replacement tests;
- health aggregation and degraded/unavailable state tests;
- API authorization and redacted diagnostic report tests;
- database migration tests from the current schema;
- desktop sidecar command, endpoint probing, and lifecycle unit tests;
- existing import, capture, search, export, metadata, and security regression tests.

### Build And Smoke Verification

- `npm test`, lint, TypeScript, and production Next.js build pass.
- The extension loads unpacked and completes connection, current-page capture, queue resume, and platform diagnostics smoke checks.
- The macOS desktop development build launches, survives window close/reopen through the tray, and shuts down its sidecar on Quit.
- Windows packaging configuration is validated in its native CI job.
- First-run setup works from an empty application data directory.
- The default installation performs knowledge processing without downloading or calling a model.

## Out Of Scope

- Cloud synchronization or accounts.
- Silent Chrome extension installation.
- A hosted model or embedding service.
- Signed/notarized release artifacts without user-provided credentials.
- A production auto-update backend.
- Replacing the Node/Next backend with Rust.
