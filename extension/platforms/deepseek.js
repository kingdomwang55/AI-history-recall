(() => {
  const { clean, textFrom, isConversationUrl, clickHistoryRow, discoverHistory, getHistoryScrollElement } =
    globalThis.AIHR_DOM;
  const id = "deepseek";
  const conversationPattern = /\/a\/chat\/s\/[a-zA-Z0-9_-]+/;
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
    return new URL(url).hostname === "chat.deepseek.com";
  }

  function isCurrentConversationUrl(url) {
    return isConversationUrl(matches, conversationPattern, url);
  }

  function extract() {
    const messages = [];
    document.querySelectorAll(".ds-message").forEach((element) => {
      const assistant = element.querySelector(".ds-assistant-message-main-content");
      let content = textFrom(assistant || element);
      content = content.replace(/^已思考[\s\S]*?(?=\n\n|$)/, "").trim();
      if (content) messages.push({ role: assistant ? "assistant" : "user", content });
    });
    return { platform: id, url: location.href, title: document.title, messages };
  }

  function deepSeekHistorySection(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const text = clean(node.textContent || "");
      const match = text.match(/^(置顶|今天|昨天|7\s*天内|30\s*天内)/);
      if (match) return match[1];
    }
    return null;
  }

  function discoverLinkedHistory() {
    const targets = [];
    document.querySelectorAll("a[href]").forEach((element) => {
      const href = element.getAttribute("href") || "";
      const url = href.startsWith("http") ? href : new URL(href, location.origin).toString();
      if (!isCurrentConversationUrl(url)) return;
      const title = clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
      targets.push({
        platform: id,
        url,
        title: title || url,
        ignoreKnownStreak: deepSeekHistorySection(element) === "置顶"
      });
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

  function discover(options = {}) {
    return discoverHistory({ platform: id, options, discoverLinkedHistory, getScrollElement });
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
