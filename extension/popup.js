const statusNode = document.getElementById("status");
const LOCAL_API_TOKEN = (globalThis.AIHR_LOCAL_API_TOKEN || "").trim();
const captureButton = document.getElementById("capture");
const fullCaptureButton = document.getElementById("fullCapture");
const allPlatformsCaptureButton = document.getElementById("allPlatformsCapture");
const stopCaptureButton = document.getElementById("stopCapture");
const resumeCaptureButton = document.getElementById("resumeCapture");
const clearStatusButton = document.getElementById("clearStatus");
const maxItemsInput = document.getElementById("maxItems");
const delayMsInput = document.getElementById("delayMs");

let pollTimer = null;

function localApiHeaders(headers = {}) {
  return LOCAL_API_TOKEN
    ? { ...headers, "X-AIHR-API-Token": LOCAL_API_TOKEN }
    : headers;
}

function sendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function captureCurrentTab() {
  statusNode.textContent = "Capturing...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusNode.textContent = "No active tab.";
    return;
  }

  let responseFromPage;
  try {
    responseFromPage = await sendMessage(tab.id, { type: "AIHR_CAPTURE_CURRENT" });
  } catch {
    statusNode.textContent =
      "AI History Recall is not active on this tab. Open ChatGPT, Gemini, DeepSeek, or Qwen, then reload the page once after installing the extension.";
    return;
  }
  const result = responseFromPage?.payload;

  if (!result?.platform) {
    statusNode.textContent =
      "Unsupported page. Open ChatGPT, Gemini, DeepSeek, or Qwen, then reload the page once after installing the extension.";
    return;
  }

  if (!result.messages?.length) {
    statusNode.textContent = `No messages found on ${result.platform}. Open a conversation detail page first.`;
    return;
  }

  const response = await fetch("http://localhost:3000/api/extension/capture-page", {
    method: "POST",
    headers: localApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(result)
  });
  const data = await response.json();

  if (!response.ok) {
    statusNode.textContent = data.error || "Import failed.";
    return;
  }

  statusNode.textContent = `Imported ${data.imported.importedConversations} conversation(s), ${data.imported.importedMessages} message(s).`;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function formatRun(run) {
  if (!run) {
    return "Ready. Open a supported AI history page or conversation page.";
  }

  const queuePlatformCounts = run.queuePlatformCounts
    ? Object.entries(run.queuePlatformCounts)
        .map(([platform, count]) => `${platform} ${count}`)
        .join(" · ")
    : null;
  const currentTarget = run.currentTarget
    ? `Current target: ${run.currentTarget.platform || "unknown"} ${run.currentTarget.index || "?"}/${run.currentTarget.total || "?"}${run.currentTarget.title ? ` · ${run.currentTarget.title}` : ""}`
    : null;

  const lines = [
    run.extensionVersion ? `Extension: v${run.extensionVersion} (${run.extensionBuildId || "unknown build"})` : null,
    `Status: ${run.status} / ${run.phase}`,
    run.platform ? `Platform: ${run.platform}` : null,
    `Progress: ${run.processed || 0}/${run.totalTargets || 0}`,
    queuePlatformCounts ? `Queue platforms: ${queuePlatformCounts}` : null,
    typeof run.nextIndex === "number" ? `Queue index: ${run.nextIndex}` : null,
    run.processing ? "Processing current target" : null,
    currentTarget,
    `Imported: ${run.importedConversations || 0} conversations, ${run.importedMessages || 0} messages`,
    run.discoveryProgress
      ? `Discovery progress: ${run.discoveryProgress.platform || "unknown"} / ${run.discoveryProgress.phase || "unknown"} · targets ${run.discoveryProgress.targetsFound || 0} · scanned ${run.discoveryProgress.scannedTitles || 0} · failures ${run.discoveryProgress.failures || 0}`
      : null,
    run.discoveryProgress?.platformIndex
      ? `Platform: ${run.discoveryProgress.platformIndex}/${run.discoveryProgress.totalPlatforms || "?"}`
      : null,
    run.discoveryProgress?.currentTitle ? `Current: ${run.discoveryProgress.currentTitle}` : null,
    run.discoveryProgress?.error ? `Discovery error: ${run.discoveryProgress.error}` : null,
    `Duplicates skipped: ${run.skippedDuplicates || 0}`,
    run.discovery ? `Discovery: ${run.discovery.targets?.length || 0} targets, ${run.discovery.stopReason}` : null,
    run.failures?.length ? `Failures: ${run.failures.length}` : null,
    run.error ? `Error: ${run.error}` : null
  ].filter(Boolean);

  return lines.join("\n");
}

async function refreshStatus() {
  const run = await sendRuntimeMessage({ type: "AIHR_GET_RUN_STATUS" });
  statusNode.textContent = formatRun(run);
  const running = run?.status === "running";
  fullCaptureButton.disabled = running;
  allPlatformsCaptureButton.disabled = running;
  stopCaptureButton.disabled = !running;
  resumeCaptureButton.disabled = running || !run?.queue?.length || (run?.nextIndex || 0) >= run.queue.length;
  clearStatusButton.disabled = running;
}

async function startFullCapture() {
  statusNode.textContent = "Starting full history capture...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusNode.textContent = "No active tab.";
    return;
  }

  const response = await sendRuntimeMessage({
    type: "AIHR_START_FULL_CAPTURE",
    sourceTabId: tab.id,
    options: {
      maxItems: Number(maxItemsInput.value) || 1000,
      maxScrolls: 200,
      delayMs: Number(delayMsInput.value) || 3200,
      stopAfterNoNewScrolls: 8,
      pageDelayMs: 5200,
      pageJitterMs: 3200
    }
  });

  if (!response?.ok) {
    statusNode.textContent = response?.error || "Full capture failed.";
    return;
  }

  statusNode.textContent = formatRun(response.run);
}

async function startAllPlatformsCapture() {
  statusNode.textContent = "Starting all-platform full history capture...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusNode.textContent = "No active tab.";
    return;
  }

  const response = await sendRuntimeMessage({
    type: "AIHR_START_ALL_PLATFORMS_CAPTURE",
    sourceTabId: tab.id,
    options: {
      maxItems: Number(maxItemsInput.value) || 1000,
      maxScrolls: 200,
      delayMs: Number(delayMsInput.value) || 3200,
      stopAfterNoNewScrolls: 8,
      pageDelayMs: 5200,
      pageJitterMs: 3200
    }
  });

  if (!response?.ok) {
    statusNode.textContent = response?.error || "All-platform capture failed.";
    return;
  }

  statusNode.textContent = formatRun(response.run);
}

async function stopFullCapture() {
  await sendRuntimeMessage({ type: "AIHR_STOP_FULL_CAPTURE" });
  await refreshStatus();
}

async function resumeCapture() {
  const response = await sendRuntimeMessage({ type: "AIHR_RESUME_CAPTURE" });
  if (!response?.ok) {
    statusNode.textContent = response?.error || "Resume failed.";
    return;
  }
  await refreshStatus();
}

async function clearStatus() {
  const response = await sendRuntimeMessage({ type: "AIHR_CLEAR_RUN_STATUS" });
  if (!response?.ok) {
    statusNode.textContent = response?.error || "Clear failed.";
    return;
  }
  await refreshStatus();
}

captureButton.addEventListener("click", () => {
  captureCurrentTab().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "Capture failed.";
  });
});

fullCaptureButton.addEventListener("click", () => {
  startFullCapture().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "Full capture failed.";
  });
});

allPlatformsCaptureButton.addEventListener("click", () => {
  startAllPlatformsCapture().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "All-platform capture failed.";
  });
});

stopCaptureButton.addEventListener("click", () => {
  stopFullCapture().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "Stop failed.";
  });
});

resumeCaptureButton.addEventListener("click", () => {
  resumeCapture().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "Resume failed.";
  });
});

clearStatusButton.addEventListener("click", () => {
  clearStatus().catch((error) => {
    statusNode.textContent = error instanceof Error ? error.message : "Clear failed.";
  });
});

refreshStatus().catch(() => undefined);
pollTimer = setInterval(() => {
  refreshStatus().catch(() => undefined);
}, 1600);

window.addEventListener("unload", () => {
  if (pollTimer) clearInterval(pollTimer);
});
