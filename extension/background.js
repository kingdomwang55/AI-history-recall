const chromeApi = globalThis.AIHR_CHROME_API;
const api = globalThis.AIHR_API;
const captureQueue = globalThis.AIHR_CAPTURE_QUEUE;
const scheduler = globalThis.AIHR_SCHEDULER;
const {
  sendTabMessage,
  createTab,
  queryTabs,
  updateTab,
  getTab,
  removeTab,
  getWindow,
  createWindow,
  removeWindow,
  waitForTabComplete
} = chromeApi;
const EXTENSION_VERSION = "0.1.43";
const EXTENSION_BUILD_ID = "desktop-pairing-20260717";
const DEFAULT_DELAY_MS = scheduler.delays.capture;
const DEFAULT_JITTER_MS = scheduler.delays.captureJitter;
const DISCOVERY_MESSAGE_TIMEOUT_MS = 180000;
const QWEN_DISCOVERY_MESSAGE_TIMEOUT_MS = 900000;
const QWEN_STEP_TIMEOUT_MS = 18000;
const AUTO_PILOT_INTERVAL_MS = scheduler.delays.autoPilotInterval;
const AUTO_PILOT_RETRY_MS = scheduler.delays.autoPilotRetry;
const SNAPSHOT_COOLDOWN_MS = scheduler.delays.snapshotCooldown;
const PLATFORM_HISTORY_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  deepseek: "https://chat.deepseek.com/",
  qwen: "https://www.qianwen.com/"
};
captureQueue.configure({
  extensionVersion: EXTENSION_VERSION,
  extensionBuildId: EXTENSION_BUILD_ID,
  defaultDelayMs: DEFAULT_DELAY_MS,
  defaultJitterMs: DEFAULT_JITTER_MS,
  armLease: scheduler.scheduleQueueLease
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(baseMs = DEFAULT_DELAY_MS, jitterMs = DEFAULT_JITTER_MS) {
  return scheduler.randomDelay(baseMs, jitterMs);
}

function createIncrementalTracker(options = {}) {
  const incremental = options.mode === "incremental";
  const knownUrls = new Set(Array.isArray(options.knownUrls) ? options.knownUrls : []);
  const maxItems = Math.min(Math.max(Math.trunc(Number(options.maxItems) || 50), 1), 200);
  const stopAfterKnown = Math.min(Math.max(Math.trunc(Number(options.stopAfterKnown) || 10), 1), 50);
  let scannedCount = 0;
  let knownCount = 0;
  let consecutiveKnown = 0;
  let stopped = false;
  let stopReason = null;

  return {
    consider(target) {
      if (stopped || !target?.url) return { include: false, stop: stopped };

      if (incremental && knownUrls.has(target.url) && target.ignoreKnownStreak === true) {
        return { include: false, stop: false };
      }

      scannedCount += 1;

      if (incremental && knownUrls.has(target.url)) {
        knownCount += 1;
        consecutiveKnown += 1;
        if (consecutiveKnown >= stopAfterKnown) {
          stopped = true;
          stopReason = "known_streak";
        }
        return { include: false, stop: stopped };
      }

      consecutiveKnown = 0;
      if (scannedCount >= maxItems) {
        stopped = true;
        stopReason = "max_items";
      }
      return { include: true, stop: stopped };
    },
    stats() {
      return { scannedCount, knownCount, consecutiveKnown, stopped, stopReason };
    }
  };
}

function nextSnapshotAt(options = {}) {
  const now = Number(options.now) || Date.now();
  const lastCapturedAt = Math.max(Number(options.lastCapturedAt) || 0, 0);
  const cooldownMs = Math.max(Number(options.cooldownMs) || 0, 0);
  const minDelayMs = Math.max(Number(options.minDelayMs) || 0, 0);
  const jitterMs = Math.max(Number(options.jitterMs) || 0, 0);
  const random = typeof options.random === "function" ? options.random : scheduler.random;
  const quietDelayAt = now + minDelayMs + Math.floor(random() * jitterMs);
  const cooldownAt = lastCapturedAt > 0 ? lastCapturedAt + cooldownMs : 0;
  return Math.max(quietDelayAt, cooldownAt);
}

function injectContentScript(tabId) {
  return chromeApi.executeScript({
    target: { tabId },
    files: [
      "core/constants.js",
      "core/protocol.js",
      "platforms/registry.js",
      "core/dom.js",
      "platforms/chatgpt.js",
      "platforms/gemini.js",
      "platforms/deepseek.js",
      "platforms/qwen.js",
      "incremental-sync.js",
      "content.js"
    ]
  });
}

async function ensureContentScriptsInOpenTabs() {
  const tabs = await queryTabs({
    url: [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://gemini.google.com/*",
      "https://chat.deepseek.com/*",
      "https://www.qianwen.com/*",
      "https://qianwen.com/*"
    ]
  });

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      const current = await sendTabMessage(tab.id, { type: "AIHR_CONTENT_PING" }, 1200).catch(() => null);
      if (current?.ok && current.version === EXTENSION_VERSION) return;
      await injectContentScript(tab.id).catch(() => undefined);
    })
  );
}

async function findLoadedQwenTab() {
  const tabs = await queryTabs({ url: ["https://www.qianwen.com/*", "https://qianwen.com/*"] });
  const candidates = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (tab.active && tab.windowId) {
      const browserWindow = await getWindow(tab.windowId).catch(() => null);
      if (browserWindow?.focused) continue;
    }
    let diagnostics = await sendTabMessage(tab.id, { type: "AIHR_QWEN_LIST_DIAGNOSTICS" }, 3000).catch(
      () => null
    );
    if (!diagnostics?.ok) {
      await injectContentScript(tab.id).catch(() => undefined);
      diagnostics = await sendTabMessage(tab.id, { type: "AIHR_QWEN_LIST_DIAGNOSTICS" }, 3000).catch(
        () => null
      );
    }
    if (diagnostics?.ok) candidates.push({ tab, diagnostics });
  }
  return candidates.sort(
    (left, right) =>
      (right.diagnostics.maxIndex || -1) - (left.diagnostics.maxIndex || -1) ||
      (right.diagnostics.scrollHeight || 0) - (left.diagnostics.scrollHeight || 0)
  )[0];
}

function idleStatus() {
  return {
    status: "idle",
    phase: "idle",
    extensionVersion: EXTENSION_VERSION,
    extensionBuildId: EXTENSION_BUILD_ID,
    updatedAt: new Date().toISOString()
  };
}

async function postConversation(payload) {
  const response = await api.request("/api/extension/capture-page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Local import failed.");
  }
  return data;
}

async function postDiscovery(discovery) {
  if (!discovery?.platform) return;
  await api.request("/api/extension/discovery-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform: discovery.platform,
      targetsFound: discovery.targets?.length || 0,
      failuresCount: discovery.failures?.length || 0,
      scannedTitlesCount: discovery.scannedTitles?.length || 0,
      stopReason: discovery.stopReason || null,
      scrollsPerformed: discovery.scrollsPerformed || null,
      maxItemsReached: discovery.stopReason === "max_items",
      maxScrollsReached: discovery.stopReason === "max_scrolls",
      exhaustive: discovery.exhaustive === true,
      extensionVersion: EXTENSION_VERSION,
      extensionBuildId: EXTENSION_BUILD_ID,
      lastSeenUrl: discovery.targets?.[0]?.url || null,
      mode: captureQueue.snapshot()?.mode === "incremental" ? "incremental" : "full"
    })
  }).catch(() => undefined);
}

async function filterKnownTargets(targets, options = {}) {
  if (!targets.length) return targets;
  const response = await api.request("/api/extension/filter-targets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targets,
      mode: options.mode,
      maxItems: options.maxItems,
      stopAfterKnown: options.stopAfterKnown
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.targets)) return targets;
  return data.targets;
}

async function getKnownTargetInfo(platform) {
  const response = await api.request(`/api/extension/filter-targets?platform=${encodeURIComponent(platform)}`);
  const data = await response.json().catch(() => ({}));
  return {
    knownTargetsByTitle:
      response.ok && typeof data.knownTargetsByTitle === "object" && data.knownTargetsByTitle !== null
        ? data.knownTargetsByTitle
        : {},
    knownUrls: response.ok && Array.isArray(data.knownUrls) ? data.knownUrls : []
  };
}

async function postSyncState(platform, event, details = {}) {
  const response = await api.request("/api/extension/sync-state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform, event, ...details })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update local sync state.");
  }
}

async function captureTarget(target) {
  const createOptions = { url: target.url, active: false };
  const tab = await createTab(createOptions);
  if (!tab.id) throw new Error("Failed to create capture tab.");

  try {
    await waitForTabComplete(tab.id);
    const startedAt = Date.now();
    let payload = null;
    let lastError = null;
    while (Date.now() - startedAt < 35000) {
      await sleep(randomDelay(2200, 1800));
      try {
        const response = await sendTabMessage(tab.id, { type: "AIHR_CAPTURE_CURRENT" });
        payload = response?.payload || null;
        if (payload?.messages?.length) break;
        lastError = new Error("No messages extracted yet.");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Capture message failed.");
        await injectContentScript(tab.id).catch(() => undefined);
      }
    }
    if (!payload?.messages?.length) {
      throw new Error(lastError?.message || "No messages extracted.");
    }
    return await postConversation({
      ...payload,
      platform: payload.platform || target.platform,
      url: payload.url || target.url,
      title: target.title || payload.title || target.url
    });
  } finally {
    await removeTab(tab.id);
  }
}

function dedupeTargets(targets) {
  const seen = new Set();
  const unique = [];
  for (const target of targets) {
    if (!target.url || seen.has(target.url)) continue;
    seen.add(target.url);
    unique.push(target);
  }
  return unique;
}

function buildDiscoverOptions(options) {
  return {
    mode: options?.mode === "incremental" ? "incremental" : "full",
    maxItems: options?.maxItems || (options?.mode === "incremental" ? 50 : 1000),
    maxScrolls: options?.maxScrolls || 200,
    delayMs: options?.delayMs || 3200,
    stopAfterNoNewScrolls: options?.stopAfterNoNewScrolls || 8,
    stopAfterKnown: options?.stopAfterKnown || 10,
    knownUrls: Array.isArray(options?.knownUrls) ? options.knownUrls : []
  };
}

async function shouldStopRun() {
  return (await captureQueue.load())?.stopRequested === true;
}

async function saveDiscoveryProgress(progress) {
  const run = captureQueue.snapshot() || (await captureQueue.load());
  await captureQueue.patch({
    discoveryProgress: {
      ...run?.discoveryProgress,
      ...progress,
      updatedAt: new Date().toISOString()
    }
  });
}

async function discoverQwenPlatform(tab, options) {
  const discoverOptions = buildDiscoverOptions(options);
  const tracker = createIncrementalTracker(discoverOptions);
  const maxItems = Math.min(Math.max(Number(discoverOptions.maxItems) || 1000, 1), 3000);
  const maxScrolls = Math.min(Math.max(Number(discoverOptions.maxScrolls) || 200, 1), 600);
  const delayMs = Math.min(Math.max(Number(discoverOptions.delayMs) || 3200, 1200), 30000);
  const stopAfterNoNewScrolls = Math.min(Math.max(Number(discoverOptions.stopAfterNoNewScrolls) || 8, 2), 30);
  const targets = [];
  const scannedTitles = [];
  const failures = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  let noNewScrolls = 0;
  let scrollsPerformed = 0;
  let stopReason = "max_scrolls";

  for (let scrollIndex = 0; scrollIndex < maxScrolls && targets.length < maxItems; scrollIndex += 1) {
    if (await shouldStopRun()) {
      stopReason = "stopped";
      break;
    }

    const beforeCount = targets.length;
    await saveDiscoveryProgress({
      platform: "qwen",
      phase: "listing_rows",
      scrollIndex,
      maxScrolls,
      targetsFound: targets.length,
      scannedTitles: scannedTitles.length,
      failures: failures.length
    });

    const rowsResponse = await sendTabMessage(tab.id, { type: "AIHR_QWEN_VISIBLE_ROWS" }, QWEN_STEP_TIMEOUT_MS);
    const rows = Array.isArray(rowsResponse?.rows) ? rowsResponse.rows : [];

    for (const row of rows) {
      if (await shouldStopRun()) {
        stopReason = "stopped";
        break;
      }
      if (targets.length >= maxItems) break;
      if (!row?.title || seenTitles.has(row.title)) continue;

      seenTitles.add(row.title);
      scannedTitles.push(row.title);
      await saveDiscoveryProgress({
        platform: "qwen",
        phase: "clicking_row",
        scrollIndex,
        maxScrolls,
        currentTitle: row.title,
        targetsFound: targets.length,
        scannedTitles: scannedTitles.length,
        failures: failures.length
      });

      try {
        const clickResponse = await sendTabMessage(
          tab.id,
          {
            type: "AIHR_QWEN_CLICK_ROW",
            rowKey: row.key,
            title: row.title
          },
          QWEN_STEP_TIMEOUT_MS
        );

        const target = clickResponse?.target;
        if (!clickResponse?.ok || !target?.url) {
          throw new Error(clickResponse?.error || "Qwen row did not return a target URL.");
        }
        if (seenUrls.has(target.url)) continue;

        seenUrls.add(target.url);
        const normalizedTarget = {
          platform: "qwen",
          url: target.url,
          title: target.title || row.title
        };
        const decision = tracker.consider(normalizedTarget);
        if (decision.include) targets.push(normalizedTarget);
        if (decision.stop) stopReason = tracker.stats().stopReason || "known_streak";
        await saveDiscoveryProgress({
          platform: "qwen",
          phase: "row_target_found",
          scrollIndex,
          maxScrolls,
          currentTitle: row.title,
          targetsFound: targets.length,
          scannedTitles: scannedTitles.length,
          failures: failures.length
        });
      } catch (error) {
        const failure = {
          platform: "qwen",
          title: row.title,
          error: error instanceof Error ? error.message : "Qwen row discovery failed."
        };
        failures.push(failure);
        await saveDiscoveryProgress({
          platform: "qwen",
          phase: "row_failed",
          scrollIndex,
          maxScrolls,
          currentTitle: row.title,
          targetsFound: targets.length,
          scannedTitles: scannedTitles.length,
          failures: failures.length,
          error: failure.error
        });
      }

      await sleep(randomDelay(delayMs, Math.floor(delayMs * 0.6)));
      if (tracker.stats().stopped) break;
    }

    if (stopReason === "stopped" || tracker.stats().stopped) break;

    scrollsPerformed = scrollIndex + 1;
    noNewScrolls = targets.length === beforeCount ? noNewScrolls + 1 : 0;
    if (targets.length >= maxItems) {
      stopReason = "max_items";
      break;
    }
    if (noNewScrolls >= stopAfterNoNewScrolls) {
      stopReason = "no_new_targets";
      break;
    }

    await saveDiscoveryProgress({
      platform: "qwen",
      phase: "scrolling_history",
      scrollIndex,
      maxScrolls,
      targetsFound: targets.length,
      scannedTitles: scannedTitles.length,
      failures: failures.length
    });
    const scrollResponse = await sendTabMessage(
      tab.id,
      { type: "AIHR_QWEN_SCROLL_HISTORY", amount: 720 },
      QWEN_STEP_TIMEOUT_MS
    ).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Qwen history scroll failed."
    }));
    await saveDiscoveryProgress({
      platform: "qwen",
      phase: "scrolling_history",
      scrollIndex,
      maxScrolls,
      targetsFound: targets.length,
      scannedTitles: scannedTitles.length,
      failures: failures.length,
      scrollBefore: scrollResponse?.before,
      scrollAfter: scrollResponse?.after,
      scrollTarget: scrollResponse?.target,
      scrollMoved: scrollResponse?.moved,
      scrollAtEnd: scrollResponse?.atEnd
    });
    if (!scrollResponse?.ok || (scrollResponse.moved === false && scrollResponse.atEnd !== true)) {
      failures.push({
        platform: "qwen",
        title: "history_scroll",
        error: scrollResponse?.error || "Qwen history list did not move."
      });
      stopReason = "scroll_stalled";
      break;
    }
    await sleep(delayMs);
  }

  await saveDiscoveryProgress({
    platform: "qwen",
    phase: "finished",
    stopReason,
    targetsFound: targets.length,
    scannedTitles: scannedTitles.length,
    failures: failures.length
  });

  return {
    ok: true,
    platform: "qwen",
    targets: dedupeTargets(targets).slice(0, maxItems),
    failures: failures.slice(-80),
    scannedTitles: [...new Set(scannedTitles)].slice(0, maxItems + 200),
    stopReason,
    scrollsPerformed,
    exhaustive: discoverOptions.mode !== "incremental" && stopReason === "no_new_targets",
    incremental: tracker.stats()
  };
}

async function discoverClickableHistoryPlatform(platform, tab, options) {
  const discoverOptions = buildDiscoverOptions(options);
  const tracker = createIncrementalTracker(discoverOptions);
  const maxItems = Math.min(Math.max(Number(discoverOptions.maxItems) || 1000, 1), 3000);
  const maxScrolls = Math.min(Math.max(Number(discoverOptions.maxScrolls) || 200, 1), 600);
  const delayMs = Math.min(Math.max(Number(discoverOptions.delayMs) || 3200, 1200), 30000);
  const stopAfterNoNewScrolls = Math.min(Math.max(Number(discoverOptions.stopAfterNoNewScrolls) || 8, 2), 30);
  const targets = [];
  const scannedTitles = [];
  const failures = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  let noNewScrolls = 0;
  let scrollsPerformed = 0;
  let stopReason = "max_scrolls";

  for (let scrollIndex = 0; scrollIndex < maxScrolls && targets.length < maxItems; scrollIndex += 1) {
    if (await shouldStopRun()) {
      stopReason = "stopped";
      break;
    }

    const beforeCount = targets.length;
    await saveDiscoveryProgress({
      platform,
      phase: "listing_clickable_rows",
      scrollIndex,
      maxScrolls,
      targetsFound: targets.length,
      scannedTitles: scannedTitles.length,
      failures: failures.length
    });

    const rowsResponse = await sendTabMessage(
      tab.id,
      { type: "AIHR_VISIBLE_HISTORY_ROWS", platform },
      QWEN_STEP_TIMEOUT_MS
    );
    const rows = Array.isArray(rowsResponse?.rows) ? rowsResponse.rows : [];

    for (const row of rows) {
      if (await shouldStopRun()) {
        stopReason = "stopped";
        break;
      }
      if (targets.length >= maxItems) break;
      if (!row?.title || seenTitles.has(row.title)) continue;

      seenTitles.add(row.title);
      scannedTitles.push(row.title);
      await saveDiscoveryProgress({
        platform,
        phase: "clicking_row",
        scrollIndex,
        maxScrolls,
        currentTitle: row.title,
        targetsFound: targets.length,
        scannedTitles: scannedTitles.length,
        failures: failures.length
      });

      try {
        const clickResponse = await sendTabMessage(
          tab.id,
          {
            type: "AIHR_CLICK_HISTORY_ROW",
            platform,
            rowKey: row.key,
            title: row.title
          },
          QWEN_STEP_TIMEOUT_MS
        );

        const target = clickResponse?.target;
        if (!clickResponse?.ok || !target?.url) {
          throw new Error(clickResponse?.error || `${platform} row did not return a target URL.`);
        }
        if (seenUrls.has(target.url)) continue;

        seenUrls.add(target.url);
        const normalizedTarget = {
          platform,
          url: target.url,
          title: target.title || row.title
        };
        const decision = tracker.consider(normalizedTarget);
        if (decision.include) targets.push(normalizedTarget);
        if (decision.stop) stopReason = tracker.stats().stopReason || "known_streak";
      } catch (error) {
        failures.push({
          platform,
          title: row.title,
          error: error instanceof Error ? error.message : `${platform} history row discovery failed.`
        });
      }

      await sleep(randomDelay(delayMs, Math.floor(delayMs * 0.6)));
      if (tracker.stats().stopped) break;
    }

    if (stopReason === "stopped" || tracker.stats().stopped) break;

    scrollsPerformed = scrollIndex + 1;
    noNewScrolls = targets.length === beforeCount ? noNewScrolls + 1 : 0;
    if (targets.length >= maxItems) {
      stopReason = "max_items";
      break;
    }
    if (noNewScrolls >= stopAfterNoNewScrolls) {
      stopReason = "no_new_targets";
      break;
    }

    await saveDiscoveryProgress({
      platform,
      phase: "scrolling_clickable_history",
      scrollIndex,
      maxScrolls,
      targetsFound: targets.length,
      scannedTitles: scannedTitles.length,
      failures: failures.length
    });
    await sendTabMessage(tab.id, { type: "AIHR_SCROLL_HISTORY", platform, amount: 720 }, QWEN_STEP_TIMEOUT_MS).catch(
      () => undefined
    );
    await sleep(delayMs);
  }

  await saveDiscoveryProgress({
    platform,
    phase: "finished",
    stopReason,
    targetsFound: targets.length,
    scannedTitles: scannedTitles.length,
    failures: failures.length
  });

  return {
    ok: true,
    platform,
    targets: dedupeTargets(targets).slice(0, maxItems),
    failures: failures.slice(-80),
    scannedTitles: [...new Set(scannedTitles)].slice(0, maxItems + 200),
    stopReason,
    scrollsPerformed,
    exhaustive: discoverOptions.mode !== "incremental" && stopReason === "no_new_targets",
    incremental: tracker.stats()
  };
}

async function finalizeIncrementalRun(run) {
  if (run?.mode !== "incremental" || run.syncFinalized) return;
  const platformResults = run.platformResults || {};
  const failures = Array.isArray(run.failures) ? run.failures : [];

  for (const platform of run.platforms || []) {
    const platformFailure = failures.find((failure) => failure.platform === platform);
    if (platformFailure) {
      await postSyncState(platform, "failed", {
        error: platformFailure.error || "增量同步失败",
        backoffUntil: scheduler.retryUntil()
      }).catch(() => undefined);
      continue;
    }

    const result = platformResults[platform] || {};
    const discovery = (run.discoveries || []).find((item) => item.platform === platform);
    await postSyncState(platform, "succeeded", {
      newConversations: result.newConversations || 0,
      newMessages: result.newMessages || 0,
      lastSeenUrl: discovery?.targets?.[0]?.url || null
    }).catch(() => undefined);
  }

  await captureQueue.patch({ syncFinalized: true });
  await scheduleBackgroundAutoPilot(AUTO_PILOT_INTERVAL_MS);
}

async function hasRunningTask() {
  return (await captureQueue.load())?.status === "running";
}

async function restoreQueueAlarm() {
  const run = await captureQueue.restore(Date.now());
  if (run?.status === "running" && run.phase === "capturing") {
    const leaseUntil = Number(run.leaseUntil) || 0;
    const remainingLease = run.processing && leaseUntil > Date.now() ? leaseUntil - Date.now() : 1500;
    scheduler.scheduleQueueStep(remainingLease);
  }
}

async function recoverInterruptedDiscovery() {
  const run = await captureQueue.load();
  if (run?.status !== "running" || !String(run.phase || "").startsWith("discovering")) return;
  await captureQueue.patch({
    status: "failed",
    phase: "discovery_interrupted",
    processing: false,
    error: "Extension restarted during history discovery; the local app can safely retry this platform."
  });
}

async function processQueueStep() {
  const run = await captureQueue.load();
  if (!run || run.status !== "running" || run.phase !== "capturing") return;

  if (run.stopRequested) {
    await captureQueue.stop();
    return;
  }

  if (run.processing) {
    const startedAt = run.processingStartedAt ? Date.parse(run.processingStartedAt) : 0;
    const leaseUntil = Number(run.leaseUntil) || (startedAt ? startedAt + captureQueue.leaseMs : 0);
    if (leaseUntil && leaseUntil <= Date.now()) {
      await captureQueue.restore(Date.now());
      scheduler.scheduleQueueStep(1000);
      return;
    }
    scheduler.scheduleQueueStep(5000);
    return;
  }

  const queue = Array.isArray(run.queue) ? run.queue : [];
  const nextIndex = Number(run.nextIndex) || 0;

  if (!queue[nextIndex]) {
    await finalizeIncrementalRun(run);
    await captureQueue.complete();
    return;
  }

  const claim = await captureQueue.claim();
  if (!claim) return;
  const target = claim.target;
  let completion;

  try {
    const data = await captureTarget(target);
    completion = await captureQueue.succeed(claim, data);
  } catch (error) {
    completion = await captureQueue.fail(claim, error);
  }

  if (completion.stale) return;

  const latest = await captureQueue.load();
  if (latest?.status === "running" && latest.phase === "capturing") {
    scheduler.scheduleQueueStep(
      randomDelay(
        latest.options?.pageDelayMs || DEFAULT_DELAY_MS,
        latest.options?.pageJitterMs || DEFAULT_JITTER_MS
      )
    );
  }
}

async function runFullCapture({ sourceTabId, options }) {
  if (captureQueue.snapshot()?.status === "running") {
    throw new Error("A full capture is already running.");
  }

  let run = {
    id: crypto.randomUUID(),
    extensionVersion: EXTENSION_VERSION,
    extensionBuildId: EXTENSION_BUILD_ID,
    status: "running",
    phase: "discovering",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform: null,
    totalTargets: 0,
    processed: 0,
    importedConversations: 0,
    importedMessages: 0,
    skippedDuplicates: 0,
    failures: [],
    stopRequested: false
  };
  run = await captureQueue.start(run);

  try {
    const discovery = await sendTabMessage(
      sourceTabId,
      {
        type: "AIHR_DISCOVER_HISTORY",
        options: buildDiscoverOptions(options)
      },
      DISCOVERY_MESSAGE_TIMEOUT_MS
    );

    if (!discovery?.ok) {
      throw new Error(discovery?.error || "Discovery failed.");
    }
    await postDiscovery(discovery);

    const targets = dedupeTargets(discovery.targets || []);

    run = await captureQueue.patch({
      platform: discovery.platform,
      discovery,
      totalTargets: targets.length
    });

    run = await captureQueue.initialize(targets, options);
    if (run.status === "running" && run.phase === "capturing") scheduler.scheduleQueueStep(1000);
    return run;
  } catch (error) {
    await captureQueue.patch({
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : "Full capture failed."
    });
    throw error;
  }
}

async function discoverPlatform(platform, openerTabId, options) {
  let discoveryWindowId = null;
  let borrowedTab = null;
  let tab;

  if (platform === "qwen") {
    borrowedTab = await findLoadedQwenTab();
    if (borrowedTab?.tab?.id && (borrowedTab.diagnostics.maxIndex || -1) >= 50) {
      tab = borrowedTab.tab;
      await sendTabMessage(tab.id, { type: "AIHR_QWEN_PREPARE_HISTORY" }, 5000);
      await sleep(800);
    } else {
      borrowedTab = null;
      const discoveryWindow = await createWindow({
        url: PLATFORM_HISTORY_URLS[platform],
        type: "normal",
        focused: false,
        width: 960,
        height: 720
      });
      discoveryWindowId = discoveryWindow.id || null;
      tab = discoveryWindow.tabs?.[0];
    }
  } else {
    const createOptions = { url: PLATFORM_HISTORY_URLS[platform], active: false };
    if (openerTabId) createOptions.openerTabId = openerTabId;
    tab = await createTab(createOptions);
  }
  if (!tab.id) throw new Error(`Failed to open ${platform}.`);

  try {
    await saveDiscoveryProgress({
      platform,
      phase: "opening_history",
      targetsFound: 0,
      scannedTitles: 0,
      failures: 0
    });
    await waitForTabComplete(tab.id);
    await sleep(randomDelay(3000, 2400));
    const knownTargetInfo = await getKnownTargetInfo(platform).catch(() => ({
      knownTargetsByTitle: {},
      knownUrls: []
    }));
    const discoverOptions = {
      ...buildDiscoverOptions(options),
      knownUrls: knownTargetInfo.knownUrls
    };
    if (platform === "qwen") {
      if (options?.useLegacyQwenDiscovery === true) {
        return await discoverQwenPlatform(tab, discoverOptions);
      }
      const discovery = await sendTabMessage(
        tab.id,
        {
          type: "AIHR_DISCOVER_QWEN_HISTORY",
          options: {
            ...discoverOptions,
            knownTargetsByTitle: knownTargetInfo.knownTargetsByTitle,
            runId: captureQueue.snapshot()?.id || null,
            restoreAfterClick: Boolean(borrowedTab)
          }
        },
        QWEN_DISCOVERY_MESSAGE_TIMEOUT_MS
      );
      await saveDiscoveryProgress({
        platform,
        phase: discovery?.ok ? "finished" : "failed",
        targetsFound: discovery?.targets?.length || 0,
        scannedTitles: discovery?.scannedTitles?.length || 0,
        failures: discovery?.failures?.length || 0,
        stopReason: discovery?.stopReason || null,
        error: discovery?.error || null
      });
      return discovery;
    }
    await saveDiscoveryProgress({
      platform,
      phase: "scrolling_history",
      targetsFound: 0,
      scannedTitles: 0,
      failures: 0
    });
    const discovery = await sendTabMessage(
      tab.id,
      {
        type: "AIHR_DISCOVER_HISTORY",
        options: discoverOptions
      },
      DISCOVERY_MESSAGE_TIMEOUT_MS
    );

    if (
      platform === "gemini" &&
      discovery?.ok &&
      (discovery.targets?.length || 0) === 0 &&
      (discovery.scannedTitles?.length || 0) === 0
    ) {
      await saveDiscoveryProgress({
        platform,
        phase: "fallback_clickable_history",
        targetsFound: 0,
        scannedTitles: 0,
        failures: 0
      });
      return await discoverClickableHistoryPlatform(platform, tab, discoverOptions);
    }

    await saveDiscoveryProgress({
      platform,
      phase: discovery?.ok ? "finished" : "failed",
      targetsFound: discovery?.targets?.length || 0,
      scannedTitles: discovery?.scannedTitles?.length || 0,
      failures: discovery?.failures?.length || 0,
      stopReason: discovery?.stopReason || null
    });
    return discovery;
  } finally {
    if (borrowedTab?.tab?.id && borrowedTab.diagnostics?.url) {
      await updateTab(borrowedTab.tab.id, { url: borrowedTab.diagnostics.url });
    } else if (discoveryWindowId) await removeWindow(discoveryWindowId);
    else await removeTab(tab.id);
  }
}

async function runAllPlatformsCapture({ sourceTabId, options }) {
  if (captureQueue.snapshot()?.status === "running") {
    throw new Error("A full capture is already running.");
  }

  const requestedPlatforms = Array.isArray(options?.platforms)
    ? options.platforms.filter((platform) => PLATFORM_HISTORY_URLS[platform])
    : [];

  let run = {
    id: crypto.randomUUID(),
    extensionVersion: EXTENSION_VERSION,
    extensionBuildId: EXTENSION_BUILD_ID,
    status: "running",
    mode: options?.mode === "incremental" ? "incremental" : "full",
    phase: "discovering_all_platforms",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform: "all",
    platforms: requestedPlatforms.length ? requestedPlatforms : Object.keys(PLATFORM_HISTORY_URLS),
    totalTargets: 0,
    processed: 0,
    importedConversations: 0,
    importedMessages: 0,
    skippedDuplicates: 0,
    failures: [],
    discoveries: [],
    platformResults: {},
    stopRequested: false
  };
  run = await captureQueue.start(run);

  try {
    const allTargets = [];
    for (const platform of run.platforms) {
      if (!PLATFORM_HISTORY_URLS[platform]) continue;
      const latest = await captureQueue.load();
      run = latest || run;
      if (latest?.stopRequested) {
        run = await captureQueue.patch({ status: "stopped", phase: "stopped" });
        return run;
      }

      try {
        if (run.mode === "incremental") {
          await postSyncState(platform, "started").catch(() => undefined);
        }
        run = await captureQueue.patch({ phase: `discovering_${platform}` });
        await saveDiscoveryProgress({
          platform,
          phase: "starting",
          platformIndex: run.platforms.indexOf(platform) + 1,
          totalPlatforms: run.platforms.length,
          targetsFound: dedupeTargets(allTargets).length,
          scannedTitles: 0,
          failures: 0
        });
        const discovery = await discoverPlatform(platform, sourceTabId, options);
        if (!discovery?.ok) throw new Error(discovery?.error || `Discovery failed for ${platform}.`);
        await postDiscovery(discovery);
        allTargets.push(...(discovery.targets || []));
        run = captureQueue.snapshot() || run;
        run = await captureQueue.patch({
          discoveries: [...(run.discoveries || []), discovery],
          totalTargets: dedupeTargets(allTargets).length
        });
      } catch (error) {
        run = captureQueue.snapshot() || run;
        if (run.mode === "incremental") {
          await postSyncState(platform, "failed", {
            error: error instanceof Error ? error.message : "Discovery failed.",
            backoffUntil: scheduler.retryUntil()
          }).catch(() => undefined);
        }
        await saveDiscoveryProgress({
          platform,
          phase: "failed",
          targetsFound: dedupeTargets(allTargets).length,
          failures: (run.failures || []).length + 1,
          error: error instanceof Error ? error.message : "Discovery failed."
        });
        run = captureQueue.snapshot() || run;
        run = await captureQueue.patch({
          failures: [
            ...(run.failures || []),
            {
              platform,
              url: PLATFORM_HISTORY_URLS[platform],
              error: error instanceof Error ? error.message : "Discovery failed."
            }
          ].slice(-80)
        });
      }
    }

    const discoveredTargets = dedupeTargets(allTargets);
    const targets = await filterKnownTargets(discoveredTargets, options);
    run = captureQueue.snapshot() || run;
    run = await captureQueue.patch({
      totalTargets: targets.length,
      skippedDuplicates: (run.skippedDuplicates || 0) + discoveredTargets.length - targets.length
    });
    run = await captureQueue.initialize(targets, options);
    if (run.status === "running" && run.phase === "capturing") scheduler.scheduleQueueStep(1000);
    if (run.status === "completed") {
      await finalizeIncrementalRun(run);
      run = captureQueue.snapshot() || run;
    }
    return run;
  } catch (error) {
    await captureQueue.patch({
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : "All-platform capture failed."
    });
    throw error;
  }
}

async function getBackgroundSyncSettings() {
  const stored = await chromeApi.storage.get("aihrBackgroundSyncSettings");
  return {
    enabled: stored.aihrBackgroundSyncSettings?.enabled !== false,
    intervalMinutes: Math.min(
      Math.max(Number(stored.aihrBackgroundSyncSettings?.intervalMinutes) || 360, 60),
      1440
    ),
    scanLimit: Math.min(Math.max(Number(stored.aihrBackgroundSyncSettings?.scanLimit) || 50, 20), 100),
    stopAfterKnown: Math.min(
      Math.max(Number(stored.aihrBackgroundSyncSettings?.stopAfterKnown) || 10, 3),
      30
    )
  };
}

async function setBackgroundSyncEnabled(enabled) {
  const settings = await getBackgroundSyncSettings();
  const nextSettings = { ...settings, enabled: Boolean(enabled) };
  await chromeApi.storage.set({ aihrBackgroundSyncSettings: nextSettings });
  await Promise.all(
    Object.keys(PLATFORM_HISTORY_URLS).map((platform) =>
      postSyncState(platform, "background", { enabled: nextSettings.enabled }).catch(() => undefined)
    )
  );
  if (nextSettings.enabled) {
    await scheduleBackgroundAutoPilot(scheduler.enabledDelay());
  } else {
    await scheduler.clearAutoPilot();
  }
  return nextSettings;
}

async function scheduleBackgroundAutoPilot(delayMs = AUTO_PILOT_INTERVAL_MS) {
  const settings = await getBackgroundSyncSettings();
  if (!settings.enabled) return;
  await scheduler.scheduleAutoPilot(delayMs);
}

async function ensureBackgroundAutoPilotScheduled(defaultDelayMs) {
  const nextAt = await scheduler.getAutoPilotNextAt();
  await scheduleBackgroundAutoPilot(nextAt > Date.now() ? nextAt - Date.now() : defaultDelayMs);
}

async function runBackgroundAutoPilot() {
  const run = await captureQueue.load();
  const settings = await getBackgroundSyncSettings();
  if (!settings.enabled) return;
  if (run?.status === "running") {
    await scheduleBackgroundAutoPilot(AUTO_PILOT_RETRY_MS);
    return;
  }

  const nextAt = await scheduler.getAutoPilotNextAt();
  if (nextAt > Date.now()) {
    await scheduler.restoreAutoPilot(nextAt);
    return;
  }

  const response = await api.request("/api/capture/audit");
  if (!response.ok) {
    await scheduleBackgroundAutoPilot(AUTO_PILOT_RETRY_MS);
    return;
  }

  const payload = await response.json();
  const now = Date.now();
  const intervalMs = settings.intervalMinutes * 60 * 1000;
  const platforms = (payload?.audit?.platforms || [])
    .filter(
      (item) => {
        const syncState = item?.syncState || {};
        if (syncState.backgroundEnabled === false) return false;
        const backoffUntil = syncState.backoffUntil ? Date.parse(syncState.backoffUntil) : 0;
        if (backoffUntil > now) return false;
        const lastSyncedAt = syncState.lastSyncedAt ? Date.parse(syncState.lastSyncedAt) : 0;
        return !lastSyncedAt || now - lastSyncedAt >= intervalMs;
      }
    )
    .map((item) => item.platform)
    .filter((platform) => PLATFORM_HISTORY_URLS[platform]);

  if (!platforms.length) {
    await scheduleBackgroundAutoPilot(intervalMs);
    return;
  }

  await scheduler.setAutoPilotNextAt(Date.now() + intervalMs);
  await runAllPlatformsCapture({
    sourceTabId: undefined,
    options: {
      platforms,
      mode: "incremental",
      maxItems: settings.scanLimit,
      maxScrolls: 30,
      delayMs: 3800,
      stopAfterNoNewScrolls: 4,
      stopAfterKnown: settings.stopAfterKnown,
      pageDelayMs: DEFAULT_DELAY_MS,
      pageJitterMs: DEFAULT_JITTER_MS
    }
  });
}

function platformFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (["chatgpt.com", "chat.openai.com"].includes(parsed.hostname)) return "chatgpt";
    if (parsed.hostname === "gemini.google.com") return "gemini";
    if (parsed.hostname === "chat.deepseek.com") return "deepseek";
    if (["www.qianwen.com", "qianwen.com"].includes(parsed.hostname)) return "qwen";
  } catch {
    return null;
  }
  return null;
}

function isConversationUrl(url) {
  const platform = platformFromUrl(url);
  if (!platform) return false;
  try {
    const pathname = new URL(url).pathname;
    if (platform === "chatgpt") return /\/c\/[a-zA-Z0-9-]+/.test(pathname);
    if (platform === "gemini") return /\/app\/[a-zA-Z0-9_-]+/.test(pathname);
    if (platform === "deepseek") return /\/a\/chat\/s\/[a-zA-Z0-9_-]+/.test(pathname);
    return /\/chat\/[a-zA-Z0-9_-]+/.test(pathname);
  } catch {
    return false;
  }
}

async function scheduleConversationSnapshot(tabId, url) {
  if (!tabId || !isConversationUrl(url)) return;
  const settings = await getBackgroundSyncSettings();
  if (!settings.enabled) return;
  const stored = await chromeApi.storage.get("aihrSnapshotCooldowns");
  const lastCapturedAt = Number(stored.aihrSnapshotCooldowns?.[url]) || 0;
  const scheduledAt = nextSnapshotAt({
    now: Date.now(),
    lastCapturedAt,
    cooldownMs: SNAPSHOT_COOLDOWN_MS,
    minDelayMs: 20000,
    jitterMs: 25000
  });
  await scheduler.scheduleSnapshot(tabId, scheduledAt);
}

async function captureOpenTabSnapshot(tabId) {
  const settings = await getBackgroundSyncSettings();
  if (!settings.enabled) return;
  const run = await captureQueue.load();
  if (run?.status === "running") return;
  const tab = await getTab(tabId);
  if (!tab?.url || !isConversationUrl(tab.url)) return;

  const stored = await chromeApi.storage.get("aihrSnapshotCooldowns");
  const cooldowns = stored.aihrSnapshotCooldowns || {};
  if (Date.now() - (Number(cooldowns[tab.url]) || 0) < SNAPSHOT_COOLDOWN_MS) return;

  let response;
  try {
    response = await sendTabMessage(tabId, { type: "AIHR_CAPTURE_CURRENT" });
  } catch {
    await injectContentScript(tabId);
    await sleep(1200);
    response = await sendTabMessage(tabId, { type: "AIHR_CAPTURE_CURRENT" });
  }
  if (!response?.payload?.messages?.length) return;
  await postConversation(response.payload);
  cooldowns[tab.url] = Date.now();
  const entries = Object.entries(cooldowns)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 200);
  await chromeApi.storage.set({ aihrSnapshotCooldowns: Object.fromEntries(entries) });
}

async function getConnectedPlatforms() {
  const tabs = await queryTabs({
    url: [
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://gemini.google.com/*",
      "https://chat.deepseek.com/*",
      "https://www.qianwen.com/*",
      "https://qianwen.com/*"
    ]
  });
  return [...new Set(tabs.map((tab) => platformFromUrl(tab.url || "")).filter(Boolean))];
}

async function getRuntimeStatus() {
  const run = (await captureQueue.load()) || idleStatus();
  const nextAt = await scheduler.getAutoPilotNextAt();
  return {
    ...run,
    connectedPlatforms: await getConnectedPlatforms(),
    backgroundSync: {
      ...(await getBackgroundSyncSettings()),
      nextAt: nextAt ? new Date(nextAt).toISOString() : null
    }
  };
}

chromeApi.onMessage((message, sender, sendResponse) => {
  if (message?.type === "AIHR_CONVERSATION_ACTIVITY") {
    const tabId = sender.tab?.id;
    const url = typeof message.url === "string" ? message.url : sender.tab?.url;
    scheduleConversationSnapshot(tabId, url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Snapshot scheduling failed." })
      );
    return true;
  }

  if (message?.type === "AIHR_GET_RUN_STATUS") {
    getRuntimeStatus().then((run) => sendResponse(run));
    return true;
  }

  if (message?.type === "AIHR_SET_BACKGROUND_SYNC") {
    setBackgroundSyncEnabled(message.enabled)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Background sync update failed." })
      );
    return true;
  }

  if (message?.type === "AIHR_SET_API_TOKEN") {
    globalThis.AIHR_API.setToken(message.token)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Pairing failed." })
      );
    return true;
  }

  if (message?.type === "AIHR_QWEN_DISCOVERY_PROGRESS") {
    captureQueue
      .load()
      .then((run) => {
        if (!run?.id || !message.runId || run.id !== message.runId) {
          return { ignored: true };
        }
        return saveDiscoveryProgress(message.progress || {}).then(() => ({ ignored: false }));
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Progress update failed." })
      );
    return true;
  }

  if (message?.type === "AIHR_STOP_FULL_CAPTURE") {
    captureQueue
      .load()
      .then((run) => (run ? captureQueue.requestStop() : null))
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "AIHR_RESUME_CAPTURE") {
    captureQueue.resume()
      .then((run) => {
        scheduler.scheduleQueueStep(1000);
        return run;
      })
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Resume failed."
        })
      );
    return true;
  }

  if (message?.type === "AIHR_CLEAR_RUN_STATUS") {
    scheduler
      .clearQueue()
      .then(() => captureQueue.clear())
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Clear failed."
        })
      );
    return true;
  }

  if (message?.type === "AIHR_RELOAD_EXTENSION") {
    sendResponse({ ok: true, reloading: true, version: EXTENSION_VERSION, buildId: EXTENSION_BUILD_ID });
    setTimeout(() => chromeApi.reload(), 100);
    return true;
  }

  if (message?.type === "AIHR_START_FULL_CAPTURE") {
    hasRunningTask().then((running) => {
      if (running) {
        sendResponse({ ok: false, error: "A full capture is already running." });
        return;
      }

      runFullCapture(message).catch(() => undefined);
      sendResponse({ ok: true, run: captureQueue.snapshot() });
    });
    return true;
  }

  if (message?.type === "AIHR_START_ALL_PLATFORMS_CAPTURE") {
    hasRunningTask().then((running) => {
      if (running) {
        sendResponse({ ok: false, error: "A full capture is already running." });
        return;
      }

      runAllPlatformsCapture(message).catch(() => undefined);
      sendResponse({ ok: true, run: captureQueue.snapshot() });
    });
    return true;
  }

  return false;
});

scheduler.onAlarm((alarm) => {
  const snapshotTabId = scheduler.snapshotTabId(alarm.name);
  if (snapshotTabId !== null) {
    captureOpenTabSnapshot(snapshotTabId).catch(() => undefined);
    return;
  }
  if (alarm.name === scheduler.names.autoPilot) {
    scheduler
      .removeAutoPilotNextAt()
      .then(() => runBackgroundAutoPilot())
      .catch(() => scheduleBackgroundAutoPilot(AUTO_PILOT_RETRY_MS).catch(() => undefined));
    return;
  }
  if (alarm.name !== scheduler.names.capture) return;
  processQueueStep().catch((error) => {
    captureQueue.patch({
      status: "failed",
      phase: "failed",
      processing: false,
      processingToken: null,
      error: error instanceof Error ? error.message : "Capture queue failed."
    }).catch(() => undefined);
  });
});

chromeApi.onTabUpdated((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if ((changeInfo.status === "complete" || changeInfo.url) && url) {
    scheduleConversationSnapshot(tabId, url).catch(() => undefined);
  }
});

chromeApi.onTabRemoved((tabId) => {
  scheduler.clearSnapshot(tabId).catch(() => undefined);
});

chromeApi.onStartup(() => {
  ensureContentScriptsInOpenTabs().catch(() => undefined);
  restoreQueueAlarm().catch(() => undefined);
  ensureBackgroundAutoPilotScheduled(scheduler.startupDelay()).catch(() => undefined);
});

chromeApi.onInstalled(() => {
  ensureContentScriptsInOpenTabs().catch(() => undefined);
  restoreQueueAlarm().catch(() => undefined);
  ensureBackgroundAutoPilotScheduled(scheduler.startupDelay()).catch(() => undefined);
});

chromeApi.onStartup(() => {
  processQueueStep().catch(() => undefined);
});

chromeApi.onInstalled(() => {
  processQueueStep().catch(() => undefined);
});

recoverInterruptedDiscovery()
  .then(() => ensureBackgroundAutoPilotScheduled(scheduler.startupDelay()))
  .catch(() => scheduleBackgroundAutoPilot(AUTO_PILOT_RETRY_MS).catch(() => undefined));

ensureContentScriptsInOpenTabs().catch(() => undefined);
