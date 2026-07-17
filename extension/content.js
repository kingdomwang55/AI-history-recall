(() => {
  const EXTENSION_VERSION = "0.1.42";
  const EXTENSION_BUILD_ID = "deepseek-pinned-groups-20260715";

  function currentAdapter() {
    if (!globalThis.AIHR_PLATFORMS) return null;
    return globalThis.AIHR_PLATFORMS.forUrl(location.href);
  }

  function isLocalAppUrl(url) {
    try {
      const parsed = new URL(url);
      return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.port === "3000";
    } catch {
      return false;
    }
  }

  function normalizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.filter(
      (message) =>
        message &&
        typeof message.role === "string" &&
        message.role.length > 0 &&
        typeof message.content === "string" &&
        message.content.length > 0
    );
  }

  async function extractConversation() {
    const adapter = currentAdapter();
    const extracted = adapter ? await adapter.extract() : null;
    return {
      platform: extracted?.platform || adapter?.id || null,
      url: extracted?.url || location.href,
      title: extracted?.title || document.title,
      messages: normalizeMessages(extracted?.messages)
    };
  }

  async function discoverHistory(options = {}, request = {}) {
    const adapter = currentAdapter();
    if (!adapter) return { ok: false, error: "Unsupported page.", targets: [] };
    return adapter.discover(options, request);
  }

  function runDiagnostics(request) {
    const adapter = currentAdapter();
    if (!adapter) return null;
    return adapter.diagnostics(request);
  }

  function runDiagnosticsAsync(request) {
    return Promise.resolve().then(() => runDiagnostics(request));
  }

  function respondWithDiagnostics(request, sendResponse, options = {}) {
    const fallbackResult = options.fallbackResult || { ok: false, error: "Unsupported page." };
    const fallbackError = options.fallbackError || "Diagnostics failed.";
    runDiagnosticsAsync(request)
      .then((result) => sendResponse(result || fallbackResult))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : fallbackError
        })
      );
  }

  window.__AI_HISTORY_RECALL_EXTENSION__ = {
    platform: currentAdapter()?.id || null,
    version: EXTENSION_VERSION,
    buildId: EXTENSION_BUILD_ID,
    bridge: isLocalAppUrl(location.href)
  };

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

  function installConversationActivityObserver() {
    const adapter = currentAdapter();
    if (!adapter || !document.body) return;

    let signalTimer = null;
    const scheduleSignal = () => {
      if (signalTimer !== null) return;
      signalTimer = window.setTimeout(() => {
        signalTimer = null;
        const current = currentAdapter();
        if (!current) return;
        Promise.resolve()
          .then(() => current.diagnostics({ action: "isConversationUrl", url: location.href }))
          .then((isConversation) => {
            if (!isConversation) return;
            return sendRuntimeMessage({ type: "AIHR_CONVERSATION_ACTIVITY", url: location.href });
          })
          .catch(() => undefined);
      }, 45000);
    };

    window.__AI_HISTORY_RECALL_ACTIVITY_OBSERVER__?.disconnect?.();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData")) {
        scheduleSignal();
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.__AI_HISTORY_RECALL_ACTIVITY_OBSERVER__ = observer;
  }

  if (!isLocalAppUrl(location.href)) installConversationActivityObserver();

  if (isLocalAppUrl(location.href)) {
    window.postMessage(
      {
        source: "aihr-extension",
        type: "AIHR_EXTENSION_READY",
        version: EXTENSION_VERSION,
        buildId: EXTENSION_BUILD_ID
      },
      location.origin
    );

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data;
      if (message?.source !== "aihr-web") return;
      if (!globalThis.AIHR_PROTOCOL.validate(message).ok) return;

      const requestId = message.requestId || crypto.randomUUID();
      const respond = (payload) => {
        window.postMessage(
          {
            source: "aihr-extension",
            requestId,
            version: EXTENSION_VERSION,
            buildId: EXTENSION_BUILD_ID,
            ...payload
          },
          location.origin
        );
      };

      if (message.type === "AIHR_WEB_GET_STATUS") {
        sendRuntimeMessage({ type: "AIHR_GET_RUN_STATUS" })
          .then((run) => respond({ type: "AIHR_WEB_STATUS_RESULT", ok: true, run }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_STATUS_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Status failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_STOP_CAPTURE") {
        sendRuntimeMessage({ type: "AIHR_STOP_FULL_CAPTURE" })
          .then((result) => respond({ type: "AIHR_WEB_STOP_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_STOP_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Stop failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_RESUME_CAPTURE") {
        sendRuntimeMessage({ type: "AIHR_RESUME_CAPTURE" })
          .then((result) => respond({ type: "AIHR_WEB_RESUME_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_RESUME_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Resume failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_CLEAR_STATUS") {
        sendRuntimeMessage({ type: "AIHR_CLEAR_RUN_STATUS" })
          .then((result) => respond({ type: "AIHR_WEB_CLEAR_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_CLEAR_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Clear failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_RELOAD_EXTENSION") {
        sendRuntimeMessage({ type: "AIHR_RELOAD_EXTENSION" })
          .then((result) => respond({ type: "AIHR_WEB_RELOAD_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_RELOAD_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Reload failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_SET_BACKGROUND_SYNC") {
        sendRuntimeMessage({ type: "AIHR_SET_BACKGROUND_SYNC", enabled: message.enabled !== false })
          .then((result) => respond({ type: "AIHR_WEB_BACKGROUND_SYNC_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_BACKGROUND_SYNC_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Background sync update failed."
            })
          );
      }

      if (message.type === "AIHR_WEB_START_CAPTURE") {
        const plan = message.plan || {};
        const runtimeMessage = {
          type: "AIHR_START_ALL_PLATFORMS_CAPTURE",
          sourceTabId: undefined,
          options: {
            mode: plan.mode,
            maxItems: plan.maxItems,
            maxScrolls: plan.maxScrolls,
            delayMs: plan.delayMs,
            stopAfterNoNewScrolls: plan.stopAfterNoNewScrolls,
            stopAfterKnown: plan.stopAfterKnown,
            pageDelayMs: plan.pageDelayMs,
            pageJitterMs: plan.pageJitterMs,
            platforms: plan.platforms
          }
        };

        sendRuntimeMessage(runtimeMessage)
          .then((result) => respond({ type: "AIHR_WEB_START_RESULT", ok: true, result }))
          .catch((error) =>
            respond({
              type: "AIHR_WEB_START_RESULT",
              ok: false,
              error: error instanceof Error ? error.message : "Start failed."
            })
          );
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "AIHR_CONTENT_PING") {
      sendResponse({ ok: true, version: EXTENSION_VERSION, buildId: EXTENSION_BUILD_ID });
      return false;
    }

    if (message?.type === "AIHR_PING") {
      sendResponse({
        ok: true,
        version: EXTENSION_VERSION,
        buildId: EXTENSION_BUILD_ID,
        platform: currentAdapter()?.id || null,
        url: location.href
      });
      return true;
    }

    if (message?.type === "AIHR_QWEN_LIST_DIAGNOSTICS") {
      respondWithDiagnostics({ action: "listDiagnostics" }, sendResponse);
      return true;
    }

    if (message?.type === "AIHR_QWEN_PREPARE_HISTORY") {
      respondWithDiagnostics({ action: "prepareHistory" }, sendResponse);
      return true;
    }

    if (message?.type === "AIHR_CAPTURE_CURRENT") {
      extractConversation()
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Capture failed." })
        );
      return true;
    }

    if (message?.type === "AIHR_DISCOVER_HISTORY") {
      discoverHistory(message.options)
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Discovery failed.",
            targets: []
          })
        );
      return true;
    }

    if (message?.type === "AIHR_DISCOVER_QWEN_HISTORY") {
      discoverHistory(message.options, { stepDiscovery: true })
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse({
            ok: false,
            platform: currentAdapter()?.id || null,
            error: error instanceof Error ? error.message : "Qwen discovery failed.",
            targets: [],
            failures: []
          })
        );
      return true;
    }

    if (message?.type === "AIHR_QWEN_VISIBLE_ROWS") {
      respondWithDiagnostics({ action: "visibleRows", platform: currentAdapter()?.id || null }, sendResponse);
      return true;
    }

    if (message?.type === "AIHR_QWEN_CLICK_ROW") {
      respondWithDiagnostics(
        { action: "stepClickHistoryRow", rowKey: message.rowKey, title: message.title },
        sendResponse,
        { fallbackError: "Qwen row click failed." }
      );
      return true;
    }

    if (message?.type === "AIHR_QWEN_SCROLL_HISTORY") {
      respondWithDiagnostics({ action: "stepScrollHistory", amount: message.amount }, sendResponse, {
        fallbackError: "Qwen history scroll failed."
      });
      return true;
    }

    if (message?.type === "AIHR_VISIBLE_HISTORY_ROWS") {
      const platform = message.platform || currentAdapter()?.id || null;
      respondWithDiagnostics({ action: "visibleRows", platform }, sendResponse, {
        fallbackResult: { ok: true, platform, rows: [] }
      });
      return true;
    }

    if (message?.type === "AIHR_CLICK_HISTORY_ROW") {
      const platform = message.platform || currentAdapter()?.id || null;
      respondWithDiagnostics(
        { action: "clickHistoryRow", platform, rowKey: message.rowKey, title: message.title },
        sendResponse,
        { fallbackError: "History row click failed." }
      );
      return true;
    }

    if (message?.type === "AIHR_SCROLL_HISTORY") {
      const platform = message.platform || currentAdapter()?.id || null;
      respondWithDiagnostics({ action: "scrollHistory", platform, amount: message.amount }, sendResponse, {
        fallbackError: "History scroll failed."
      });
      return true;
    }

    return false;
  });
})();
