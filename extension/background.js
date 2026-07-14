try {
  importScripts("config.js");
} catch {
  // Optional local-only config. See extension/config.example.js.
}

const LOCAL_IMPORT_URL = "http://localhost:3000/api/extension/capture-page";
const LOCAL_DISCOVERY_URL = "http://localhost:3000/api/extension/discovery-run";
const LOCAL_FILTER_TARGETS_URL = "http://localhost:3000/api/extension/filter-targets";
const LOCAL_AUDIT_URL = "http://localhost:3000/api/capture/audit";
const EXTENSION_VERSION = "0.1.38";
const EXTENSION_BUILD_ID = "no-debugger-input-20260711";
const LOCAL_API_TOKEN = (globalThis.AIHR_LOCAL_API_TOKEN || "").trim();

function localApiHeaders(headers = {}) {
  return LOCAL_API_TOKEN
    ? { ...headers, "X-AIHR-API-Token": LOCAL_API_TOKEN }
    : headers;
}
const DEFAULT_DELAY_MS = 5200;
const DEFAULT_JITTER_MS = 3200;
const DEFAULT_MESSAGE_TIMEOUT_MS = 60000;
const DISCOVERY_MESSAGE_TIMEOUT_MS = 180000;
const QWEN_DISCOVERY_MESSAGE_TIMEOUT_MS = 900000;
const QWEN_STEP_TIMEOUT_MS = 18000;
const CAPTURE_ALARM = "aihr_process_capture_queue";
const AUTO_PILOT_ALARM = "aihr_background_autopilot";
const AUTO_PILOT_RETRY_MS = 60000;
const PLATFORM_HISTORY_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  deepseek: "https://chat.deepseek.com/",
  qwen: "https://www.qianwen.com/"
};

let activeRun = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(baseMs = DEFAULT_DELAY_MS, jitterMs = DEFAULT_JITTER_MS) {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

function sendTabMessage(tabId, message, timeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out waiting for content script response."));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function createTab(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function injectContentScript(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function ensureContentScriptsInOpenTabs() {
  const tabs = await queryTabs({
    url: [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
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

function getWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.get(windowId, (browserWindow) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(browserWindow);
    });
  });
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

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function createWindow(options) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(options, (createdWindow) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(createdWindow);
    });
  });
}

function removeWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.remove(windowId, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab load."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === "complete" || Date.now() - started > timeoutMs) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function saveStatus(patch) {
  activeRun = {
    ...activeRun,
    extensionVersion: EXTENSION_VERSION,
    extensionBuildId: EXTENSION_BUILD_ID,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ aihrActiveRun: activeRun });
}

async function loadStatus() {
  const result = await chrome.storage.local.get("aihrActiveRun");
  activeRun = result.aihrActiveRun || activeRun;
  if (activeRun) {
    activeRun.extensionVersion = activeRun.extensionVersion || EXTENSION_VERSION;
    activeRun.extensionBuildId = activeRun.extensionBuildId || EXTENSION_BUILD_ID;
  }
  return activeRun;
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

function scheduleQueueStep(delayMs) {
  chrome.alarms.create(CAPTURE_ALARM, {
    when: Date.now() + Math.max(delayMs, 1000)
  });
}

async function postConversation(payload) {
  const response = await fetch(LOCAL_IMPORT_URL, {
    method: "POST",
    headers: localApiHeaders({ "content-type": "application/json" }),
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
  await fetch(LOCAL_DISCOVERY_URL, {
    method: "POST",
    headers: localApiHeaders({ "content-type": "application/json" }),
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
      extensionBuildId: EXTENSION_BUILD_ID
    })
  }).catch(() => undefined);
}

async function filterKnownTargets(targets) {
  if (!targets.length) return targets;
  const response = await fetch(LOCAL_FILTER_TARGETS_URL, {
    method: "POST",
    headers: localApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ targets })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.targets)) return targets;
  return data.targets;
}

async function getKnownTargetsByTitle(platform) {
  const response = await fetch(`${LOCAL_FILTER_TARGETS_URL}?platform=${encodeURIComponent(platform)}`, {
    headers: localApiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && typeof data.knownTargetsByTitle === "object" && data.knownTargetsByTitle !== null
    ? data.knownTargetsByTitle
    : {};
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

function countTargetsByPlatform(targets) {
  return targets.reduce((counts, target) => {
    const platform = target?.platform || "unknown";
    counts[platform] = (counts[platform] || 0) + 1;
    return counts;
  }, {});
}

function buildDiscoverOptions(options) {
  return {
    maxItems: options?.maxItems || 1000,
    maxScrolls: options?.maxScrolls || 200,
    delayMs: options?.delayMs || 3200,
    stopAfterNoNewScrolls: options?.stopAfterNoNewScrolls || 8
  };
}

async function shouldStopRun() {
  const result = await chrome.storage.local.get("aihrActiveRun");
  activeRun = result.aihrActiveRun || activeRun;
  return activeRun?.stopRequested === true;
}

async function saveDiscoveryProgress(progress) {
  await saveStatus({
    discoveryProgress: {
      ...activeRun?.discoveryProgress,
      ...progress,
      updatedAt: new Date().toISOString()
    }
  });
}

async function discoverQwenPlatform(tab, options) {
  const discoverOptions = buildDiscoverOptions(options);
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
        targets.push({
          platform: "qwen",
          url: target.url,
          title: target.title || row.title
        });
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
    }

    if (stopReason === "stopped") break;

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
    exhaustive: stopReason === "no_new_targets"
  };
}

async function discoverClickableHistoryPlatform(platform, tab, options) {
  const discoverOptions = buildDiscoverOptions(options);
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
        targets.push({
          platform,
          url: target.url,
          title: target.title || row.title
        });
      } catch (error) {
        failures.push({
          platform,
          title: row.title,
          error: error instanceof Error ? error.message : `${platform} history row discovery failed.`
        });
      }

      await sleep(randomDelay(delayMs, Math.floor(delayMs * 0.6)));
    }

    if (stopReason === "stopped") break;

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
    exhaustive: stopReason === "no_new_targets"
  };
}

async function initializeQueue(targets, options) {
  if (targets.length === 0) {
    await saveStatus({
      phase: "completed",
      status: "completed",
      queue: [],
      nextIndex: 0,
      totalTargets: 0,
      processing: false
    });
    return;
  }

  await saveStatus({
    phase: "capturing",
    queue: targets,
    queuePlatformCounts: countTargetsByPlatform(targets),
    currentTarget: null,
    discoveryProgress: null,
    nextIndex: 0,
    totalTargets: targets.length,
    options: {
      pageDelayMs: options?.pageDelayMs || DEFAULT_DELAY_MS,
      pageJitterMs: options?.pageJitterMs || DEFAULT_JITTER_MS
    }
  });
  scheduleQueueStep(1000);
}

async function hasRunningTask() {
  const run = await loadStatus();
  return run?.status === "running";
}

async function resumeQueue() {
  const run = await loadStatus();
  const queue = Array.isArray(run?.queue) ? run.queue : [];
  const nextIndex = Number(run?.nextIndex) || 0;

  if (!run || queue.length === 0 || nextIndex >= queue.length) {
    throw new Error("No resumable capture queue.");
  }

  await saveStatus({
    status: "running",
    phase: "capturing",
    stopRequested: false,
    processing: false,
    processingStartedAt: null
  });
  scheduleQueueStep(1000);
  return activeRun;
}

async function clearRunStatus() {
  activeRun = null;
  await chrome.alarms.clear(CAPTURE_ALARM);
  await chrome.storage.local.remove("aihrActiveRun");
}

async function restoreQueueAlarm() {
  const run = await loadStatus();
  if (run?.status === "running" && run.phase === "capturing") {
    await saveStatus({
      processing: false,
      processingStartedAt: null
    });
    scheduleQueueStep(1500);
  }
}

async function recoverInterruptedDiscovery() {
  const run = await loadStatus();
  if (run?.status !== "running" || !String(run.phase || "").startsWith("discovering")) return;
  await saveStatus({
    status: "failed",
    phase: "discovery_interrupted",
    processing: false,
    error: "Extension restarted during history discovery; the local app can safely retry this platform."
  });
}

async function processQueueStep() {
  const run = await loadStatus();
  if (!run || run.status !== "running" || run.phase !== "capturing") return;

  if (run.stopRequested) {
    await saveStatus({ status: "stopped", phase: "stopped", processing: false });
    return;
  }

  if (run.processing) {
    const startedAt = run.processingStartedAt ? Date.parse(run.processingStartedAt) : 0;
    if (startedAt && Date.now() - startedAt > 180000) {
      await saveStatus({ processing: false, processingStartedAt: null });
      scheduleQueueStep(1000);
      return;
    }
    scheduleQueueStep(5000);
    return;
  }

  const queue = Array.isArray(run.queue) ? run.queue : [];
  const nextIndex = Number(run.nextIndex) || 0;
  const target = queue[nextIndex];

  if (!target) {
    await saveStatus({ status: "completed", phase: "completed", processing: false, currentTarget: null });
    return;
  }

  await saveStatus({
    processing: true,
    processingStartedAt: new Date().toISOString(),
    currentTarget: {
      platform: target.platform,
      title: target.title,
      url: target.url,
      index: nextIndex + 1,
      total: queue.length
    }
  });

  try {
    const data = await captureTarget(target);
    await saveStatus({
      processed: (activeRun.processed || 0) + 1,
      nextIndex: nextIndex + 1,
      importedConversations:
        (activeRun.importedConversations || 0) + (data.imported?.importedConversations || 0),
      importedMessages: (activeRun.importedMessages || 0) + (data.imported?.importedMessages || 0),
      skippedDuplicates: (activeRun.skippedDuplicates || 0) + (data.imported?.skippedDuplicates || 0),
      processing: false,
      processingStartedAt: null,
      currentTarget: null
    });
  } catch (error) {
    await saveStatus({
      processed: (activeRun.processed || 0) + 1,
      nextIndex: nextIndex + 1,
      failures: [
        ...(activeRun.failures || []),
        {
          platform: target.platform,
          url: target.url,
          title: target.title,
          error: error instanceof Error ? error.message : "Capture failed."
        }
      ].slice(-80),
      processing: false,
      processingStartedAt: null,
      currentTarget: null
    });
  }

  const latest = await loadStatus();
  if (latest?.status === "running" && latest.phase === "capturing") {
    scheduleQueueStep(randomDelay(latest.options?.pageDelayMs || DEFAULT_DELAY_MS, latest.options?.pageJitterMs || DEFAULT_JITTER_MS));
  }
}

async function runFullCapture({ sourceTabId, options }) {
  if (activeRun?.status === "running") {
    throw new Error("A full capture is already running.");
  }

  activeRun = {
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
  await chrome.storage.local.set({ aihrActiveRun: activeRun });

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

    await saveStatus({
      platform: discovery.platform,
      discovery,
      totalTargets: targets.length
    });

    await initializeQueue(targets, options);
    return activeRun;
  } catch (error) {
    await saveStatus({
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
    if (platform === "qwen") {
      if (options?.useLegacyQwenDiscovery === true) {
        return await discoverQwenPlatform(tab, options);
      }
      const knownTargetsByTitle = await getKnownTargetsByTitle(platform);
      const discovery = await sendTabMessage(
        tab.id,
        {
          type: "AIHR_DISCOVER_QWEN_HISTORY",
          options: {
            ...buildDiscoverOptions(options),
            knownTargetsByTitle,
            runId: activeRun?.id || null,
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
        options: buildDiscoverOptions(options)
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
      return await discoverClickableHistoryPlatform(platform, tab, options);
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
  if (activeRun?.status === "running") {
    throw new Error("A full capture is already running.");
  }

  const requestedPlatforms = Array.isArray(options?.platforms)
    ? options.platforms.filter((platform) => PLATFORM_HISTORY_URLS[platform])
    : [];

  activeRun = {
    id: crypto.randomUUID(),
    extensionVersion: EXTENSION_VERSION,
    extensionBuildId: EXTENSION_BUILD_ID,
    status: "running",
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
    stopRequested: false
  };
  await chrome.storage.local.set({ aihrActiveRun: activeRun });

  try {
    const allTargets = [];
    for (const platform of activeRun.platforms) {
      if (!PLATFORM_HISTORY_URLS[platform]) continue;
      const latest = await chrome.storage.local.get("aihrActiveRun");
      if (latest.aihrActiveRun?.stopRequested) {
        await saveStatus({ status: "stopped", phase: "stopped" });
        return activeRun;
      }

      try {
        await saveStatus({ phase: `discovering_${platform}` });
        await saveDiscoveryProgress({
          platform,
          phase: "starting",
          platformIndex: activeRun.platforms.indexOf(platform) + 1,
          totalPlatforms: activeRun.platforms.length,
          targetsFound: dedupeTargets(allTargets).length,
          scannedTitles: 0,
          failures: 0
        });
        const discovery = await discoverPlatform(platform, sourceTabId, options);
        if (!discovery?.ok) throw new Error(discovery?.error || `Discovery failed for ${platform}.`);
        await postDiscovery(discovery);
        allTargets.push(...(discovery.targets || []));
        await saveStatus({
          discoveries: [...(activeRun.discoveries || []), discovery],
          totalTargets: dedupeTargets(allTargets).length
        });
      } catch (error) {
        await saveDiscoveryProgress({
          platform,
          phase: "failed",
          targetsFound: dedupeTargets(allTargets).length,
          failures: (activeRun.failures || []).length + 1,
          error: error instanceof Error ? error.message : "Discovery failed."
        });
        await saveStatus({
          failures: [
            ...activeRun.failures,
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
    const targets = await filterKnownTargets(discoveredTargets);
    await saveStatus({
      totalTargets: targets.length,
      skippedDuplicates: (activeRun.skippedDuplicates || 0) + discoveredTargets.length - targets.length
    });
    await initializeQueue(targets, options);
    return activeRun;
  } catch (error) {
    await saveStatus({
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : "All-platform capture failed."
    });
    throw error;
  }
}

async function scheduleBackgroundAutoPilot(delayMs = AUTO_PILOT_RETRY_MS) {
  await chrome.storage.local.set({ aihrAutoPilotNextAt: Date.now() + delayMs });
  await chrome.alarms.create(AUTO_PILOT_ALARM, { when: Date.now() + delayMs });
}

async function runBackgroundAutoPilot() {
  const stored = await chrome.storage.local.get(["aihrActiveRun", "aihrAutoPilotNextAt"]);
  activeRun = stored.aihrActiveRun || activeRun;
  if (activeRun?.status === "running") return;

  const nextAt = Number(stored.aihrAutoPilotNextAt) || 0;
  if (nextAt > Date.now()) {
    await chrome.alarms.create(AUTO_PILOT_ALARM, { when: nextAt });
    return;
  }

  const response = await fetch(LOCAL_AUDIT_URL, {
    headers: localApiHeaders()
  });
  if (!response.ok) {
    await scheduleBackgroundAutoPilot();
    return;
  }

  const payload = await response.json();
  const platforms = (payload?.audit?.platforms || [])
    .filter(
      (item) =>
        item?.importedConversations === 0 ||
        item?.latestDiscovery?.evidenceStrong !== true ||
        Number(item?.latestDiscovery?.failuresCount || 0) > 0
    )
    .map((item) => item.platform)
    .filter((platform) => PLATFORM_HISTORY_URLS[platform]);

  if (!platforms.length) {
    await chrome.storage.local.remove("aihrAutoPilotNextAt");
    return;
  }

  await chrome.storage.local.set({ aihrAutoPilotNextAt: Date.now() + AUTO_PILOT_RETRY_MS });
  await runAllPlatformsCapture({
    sourceTabId: undefined,
    options: {
      platforms,
      maxItems: 3000,
      maxScrolls: 200,
      delayMs: 3200,
      stopAfterNoNewScrolls: 8,
      delayBetweenPagesMs: DEFAULT_DELAY_MS,
      jitterMs: DEFAULT_JITTER_MS
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AIHR_GET_RUN_STATUS") {
    loadStatus().then((run) => sendResponse(run || idleStatus()));
    return true;
  }

  if (message?.type === "AIHR_QWEN_DISCOVERY_PROGRESS") {
    loadStatus()
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
    chrome.storage.local
      .get("aihrActiveRun")
      .then((result) => {
        activeRun = result.aihrActiveRun || activeRun;
        if (!activeRun) return null;
        return saveStatus({ stopRequested: true });
      })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "AIHR_RESUME_CAPTURE") {
    resumeQueue()
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
    clearRunStatus()
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
    setTimeout(() => chrome.runtime.reload(), 100);
    return true;
  }

  if (message?.type === "AIHR_START_FULL_CAPTURE") {
    hasRunningTask().then((running) => {
      if (running) {
        sendResponse({ ok: false, error: "A full capture is already running." });
        return;
      }

      runFullCapture(message).catch(() => undefined);
      sendResponse({ ok: true, run: activeRun });
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
      sendResponse({ ok: true, run: activeRun });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_PILOT_ALARM) {
    chrome.storage.local
      .remove("aihrAutoPilotNextAt")
      .then(() => runBackgroundAutoPilot())
      .catch(() => scheduleBackgroundAutoPilot().catch(() => undefined));
    return;
  }
  if (alarm.name !== CAPTURE_ALARM) return;
  processQueueStep().catch((error) => {
    saveStatus({
      status: "failed",
      phase: "failed",
      processing: false,
      error: error instanceof Error ? error.message : "Capture queue failed."
    }).catch(() => undefined);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureContentScriptsInOpenTabs().catch(() => undefined);
  restoreQueueAlarm().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  ensureContentScriptsInOpenTabs().catch(() => undefined);
  restoreQueueAlarm().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  processQueueStep().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  processQueueStep().catch(() => undefined);
});

recoverInterruptedDiscovery()
  .then(() => runBackgroundAutoPilot())
  .catch(() => scheduleBackgroundAutoPilot().catch(() => undefined));
ensureContentScriptsInOpenTabs().catch(() => undefined);
