(() => {
  const {
    clean,
    textFrom,
    sleep,
    isConversationUrl,
    clickHistoryRow,
    discoverHistory,
    getDiscoveryScrollElement,
    getHistoryScrollElement
  } = globalThis.AIHR_DOM;
  const id = "chatgpt";
  const conversationPattern = /\/c\/[a-zA-Z0-9-]+/;
  const historyScrollSelectors = [
    "nav",
    "aside",
    "[class*=sidebar]",
    "[class*=sider]",
    "[class*=history]",
    "[class*=conversation]",
    "[class*=session]"
  ];
  const excludedRows = new Set([
    "chatgpt",
    "deepseek",
    "new chat",
    "new conversation",
    "new task",
    "search",
    "library",
    "projects",
    "settings",
    "help",
    "more",
    "share",
    "upgrade",
    "plus",
    "历史聊天记录",
    "新聊天",
    "搜索",
    "文件库",
    "项目",
    "更多",
    "分享"
  ]);

  function matches(url) {
    const host = new URL(url).hostname;
    return host === "chatgpt.com" || host === "chat.openai.com";
  }

  function isCurrentConversationUrl(url) {
    return isConversationUrl(matches, conversationPattern, url);
  }

  function extract() {
    const messages = [];
    document.querySelectorAll("[data-message-author-role]").forEach((element) => {
      const content = textFrom(element);
      if (content) {
        messages.push({
          role: element.getAttribute("data-message-author-role") || "unknown",
          content
        });
      }
    });

    return { platform: id, url: location.href, title: document.title, messages };
  }

  function discoverLinkedHistory() {
    const targets = [];
    document.querySelectorAll("a[href]").forEach((element) => {
      const href = element.getAttribute("href") || "";
      const url = href.startsWith("http") ? href : new URL(href, location.origin).toString();
      if (!isCurrentConversationUrl(url)) return;
      const title = clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
      targets.push({ platform: id, url, title: title || url, ignoreKnownStreak: false });
    });
    return targets;
  }

  function getVisibleHistoryRows() {
    return [...document.querySelectorAll("a, button, div, [role=button], [data-testid]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const href = element.getAttribute("href") || "";
        const title = clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
        return {
          element,
          key:
            href ||
            element.getAttribute("data-testid") ||
            element.getAttribute("aria-label") ||
            `${Math.round(rect.y)}:${title}`,
          title,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter((row) => {
        const normalized = row.title.toLowerCase();
        return (
          row.x >= -8 &&
          row.x <= Math.min(440, window.innerWidth * 0.5) &&
          row.width >= 110 &&
          row.height >= 20 &&
          row.height <= 88 &&
          row.y > 60 &&
          row.y < window.innerHeight - 8 &&
          row.title &&
          row.title.length <= 160 &&
          !row.title.includes("\n") &&
          !excludedRows.has(normalized)
        );
      })
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
      .slice(0, 28);
  }

  function getScrollElement() {
    const rows = getVisibleHistoryRows();
    for (const row of rows) {
      let element = row.element.parentElement;
      while (element && element !== document.body) {
        if (element.scrollHeight > element.clientHeight + 80) return element;
        element = element.parentElement;
      }
    }
    return getHistoryScrollElement(historyScrollSelectors);
  }

  async function discoverViaApi(options = {}) {
    const maxItems = Math.min(Math.max(Number(options.maxItems) || 1000, 1), 3000);
    const limit = 100;
    const targets = [];
    const scannedTitles = [];
    const seen = new Set();
    const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker(options);
    let stopReason = "api_exhausted";
    let shouldStop = false;

    for (let offset = 0; offset < maxItems && !shouldStop; offset += limit) {
      const response = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error(`ChatGPT conversations API failed (${response.status}).`);

      const data = await response.json();
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.conversations)
          ? data.conversations
          : [];
      if (items.length === 0) break;

      for (const item of items) {
        const conversationId = clean(item.id || item.conversation_id || item.conversationId || "");
        if (!conversationId || seen.has(conversationId)) continue;
        seen.add(conversationId);
        const title = clean(item.title || item.name || "");
        if (title) scannedTitles.push(title);
        const target = {
          platform: id,
          url: `${location.origin}/c/${conversationId}`,
          title: title || `${location.origin}/c/${conversationId}`
        };
        const decision = tracker.consider(target);
        if (decision.include) targets.push(target);
        if (decision.stop) {
          stopReason = tracker.stats().stopReason || "max_items";
          shouldStop = true;
          break;
        }
      }

      if (shouldStop || items.length < limit) break;
      await sleep(900 + Math.floor(Math.random() * 700));
    }

    return {
      ok: true,
      platform: id,
      targets,
      stopReason,
      scrollsPerformed: 0,
      scannedTitles: [...new Set(scannedTitles)].slice(0, maxItems + 200),
      exhaustive: options.mode !== "incremental" && stopReason === "api_exhausted",
      incremental: tracker.stats()
    };
  }

  async function discover(options = {}) {
    try {
      const apiDiscovery = await discoverViaApi(options);
      if (apiDiscovery.targets.length > 0) return apiDiscovery;
    } catch {
      // Fall back to sidebar DOM discovery when the private same-origin list is unavailable.
    }
    return discoverHistory({ platform: id, options, discoverLinkedHistory, getScrollElement: getDiscoveryScrollElement });
  }

  function serializeRows() {
    return getVisibleHistoryRows().map(({ key, title, x, y, width, height }) => ({ key, title, x, y, width, height }));
  }

  function diagnostics(request = {}) {
    if (request.action === "isConversationUrl") return isCurrentConversationUrl(request.url);
    if (request.action === "visibleRows") {
      return { ok: true, platform: request.platform || id, rows: serializeRows() };
    }
    if (request.action === "clickHistoryRow") {
      return clickHistoryRow({
        platform: request.platform || id,
        getRows: getVisibleHistoryRows,
        isCurrentConversationUrl,
        rowKey: request.rowKey,
        title: request.title
      });
    }
    if (request.action === "scrollHistory") {
      getScrollElement().scrollBy({ top: request.amount || 720, behavior: "smooth" });
      return { ok: true };
    }
    return { ok: true, platform: id, url: location.href, conversation: isCurrentConversationUrl(location.href) };
  }

  globalThis.AIHR_PLATFORMS.register({ id, matches, discover, extract, diagnostics });
})();
