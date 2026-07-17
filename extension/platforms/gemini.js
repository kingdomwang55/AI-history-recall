(() => {
  const {
    clean,
    textFrom,
    isConversationUrl,
    clickHistoryRow,
    discoverHistory,
    getDiscoveryScrollElement,
    getHistoryScrollElement
  } = globalThis.AIHR_DOM;
  const id = "gemini";
  const conversationPattern = /\/app\/[a-zA-Z0-9_-]+/;
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
    "gemini",
    "new chat",
    "new conversation",
    "recent",
    "show more",
    "settings",
    "help",
    "activity",
    "updates",
    "extensions",
    "explore gems",
    "gems"
  ]);

  function matches(url) {
    return new URL(url).hostname === "gemini.google.com";
  }

  function isCurrentConversationUrl(url) {
    return isConversationUrl(matches, conversationPattern, url);
  }

  function extract() {
    const messages = [];
    document.querySelectorAll("user-query, message-content").forEach((element) => {
      const content = textFrom(element);
      if (content && !/^Sources\s*$/i.test(content)) {
        messages.push({
          role: element.tagName.toLowerCase() === "user-query" ? "user" : "assistant",
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
    return [...document.querySelectorAll("a, button, div, [role=button], [data-test-id]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const title = clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
        return {
          element,
          key:
            element.getAttribute("href") ||
            element.getAttribute("data-test-id") ||
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
          row.x >= -4 &&
          row.x <= Math.min(420, window.innerWidth * 0.48) &&
          row.width >= 120 &&
          row.height >= 24 &&
          row.height <= 84 &&
          row.y > 80 &&
          row.y < window.innerHeight - 8 &&
          row.title &&
          row.title.length <= 140 &&
          !row.title.includes("\n") &&
          !excludedRows.has(normalized)
        );
      })
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
      .slice(0, 24);
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

  function discover(options = {}) {
    return discoverHistory({ platform: id, options, discoverLinkedHistory, getScrollElement: getDiscoveryScrollElement });
  }

  function diagnostics(request = {}) {
    if (request.action === "isConversationUrl") return isCurrentConversationUrl(request.url);
    if (request.action === "visibleRows") {
      return {
        ok: true,
        platform: request.platform || id,
        rows: getVisibleHistoryRows().map(({ key, title, x, y, width, height }) => ({ key, title, x, y, width, height }))
      };
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
