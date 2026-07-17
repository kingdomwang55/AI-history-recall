(() => {
  const {
    clean,
    textFrom,
    sleep,
    isConversationUrl,
    clickableHistoryElement,
    clickHistoryRow: clickGenericHistoryRow,
    discoverHistory,
    getHistoryScrollElement,
    navigateBackWithSignal
  } = globalThis.AIHR_DOM;
  const id = "qwen";
  const conversationPattern = /\/chat\/[a-zA-Z0-9_-]+/;
  const historyScrollSelectors = [
    "nav",
    "aside",
    "[class*=sidebar]",
    "[class*=sider]",
    "[class*=history]",
    "[class*=conversation]",
    "[class*=session]"
  ];

  function matches(url) {
    const host = new URL(url).hostname;
    return host === "www.qianwen.com" || host === "qianwen.com";
  }

  function isCurrentConversationUrl(url) {
    return isConversationUrl(matches, conversationPattern, url);
  }

  function extract() {
    const messages = [];
    const rounds = [...document.querySelectorAll(".chat-round")];
    for (const round of rounds) {
      const question = round.querySelector(
        "[class*=question-text-card], [class*=wrapper-question], [class*=chat-question], [class*=question]"
      );
      const answer = round.querySelector(
        "[class*=markdown], [class*=answerItem], [class*=wrapper-answer], [class*=answer]"
      );
      const questionText = textFrom(question);
      const answerText = textFrom(answer);
      if (questionText) messages.push({ role: "user", content: questionText });
      if (answerText) messages.push({ role: "assistant", content: answerText });
    }
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

  function discoverVisibleHistoryTitles() {
    const titles = [...document.querySelectorAll("a, button, div")]
      .map((element) => clean(element.innerText || element.textContent || element.getAttribute("aria-label") || ""))
      .filter((title) => title && title.length <= 140)
      .filter((title) => !["我的空间", "智能体", "新分组", "新建对话"].includes(title));
    return [...new Set(titles)].slice(0, 120);
  }

  function getVisibleHistoryRows() {
    return [...document.querySelectorAll("[data-react-window-index]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const titleNode =
          element.querySelector?.("[class*=text-ellipsis]") ||
          element.querySelector?.("[class*=truncate]") ||
          element;
        const title = clean(titleNode?.innerText || titleNode?.textContent || "");
        return {
          element,
          key: element.getAttribute("data-react-window-index") || `${Math.round(rect.y)}:${title}`,
          title,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter(
        (row) =>
          row.x <= Math.min(420, window.innerWidth * 0.48) &&
          row.x >= 0 &&
          row.width >= 120 &&
          row.height >= 28 &&
          row.height <= 72 &&
          row.y > 80 &&
          row.y < window.innerHeight - 8 &&
          row.title &&
          row.title.length <= 140 &&
          !["我的空间", "智能体", "新分组", "新建对话", "最近对话", "对话分组"].includes(row.title) &&
          !row.title.includes("\n")
      )
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
      .slice(0, 24);
  }

  function getScrollElement() {
    for (const row of getVisibleHistoryRows()) {
      let element = row.element.parentElement;
      while (element && element !== document.body) {
        if (element.scrollHeight > element.clientHeight + 80) return element;
        element = element.parentElement;
      }
    }
    return getHistoryScrollElement(historyScrollSelectors, "sidebar");
  }

  async function clickHistoryRow(rowKey, title) {
    const rows = getVisibleHistoryRows();
    const row = rows.find((candidate) => candidate.key === rowKey) || rows.find((candidate) => candidate.title === title);
    if (!row) return { ok: false, error: "Qwen history row is no longer visible." };

    const originalUrl = location.href;
    clickableHistoryElement(row.element).click();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(400);
      if (location.href !== originalUrl && isCurrentConversationUrl(location.href)) {
        return { ok: true, target: { platform: id, url: location.href, title: row.title } };
      }
    }

    if (isCurrentConversationUrl(location.href)) {
      return { ok: true, target: { platform: id, url: location.href, title: row.title } };
    }
    return { ok: false, error: `Click did not open a Qwen conversation. Current URL: ${location.href}` };
  }

  function setHistoryScrollTop(scrollElement, targetTop) {
    const before = scrollElement.scrollTop;
    const target = Math.min(Math.max(0, targetTop), Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight));
    scrollElement.scrollTop = target;
    scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      ok: true,
      before,
      after: scrollElement.scrollTop,
      moved: scrollElement.scrollTop !== before,
      target,
      clientHeight: scrollElement.clientHeight,
      scrollHeight: scrollElement.scrollHeight,
      atEnd: scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 2
    };
  }

  function scrollHistory(amount = 720) {
    const scrollElement = getScrollElement();
    return setHistoryScrollTop(scrollElement, scrollElement.scrollTop + amount);
  }

  function scrollHistoryTo(targetTop) {
    return setHistoryScrollTop(getScrollElement(), targetTop);
  }

  async function clickDiscoverVisibleRows(seen) {
    const targets = [];
    const rows = [...document.querySelectorAll("div")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          title: clean(element.innerText || element.textContent),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter(
        (row) =>
          row.x <= 36 &&
          row.width >= 180 &&
          row.height >= 28 &&
          row.height <= 52 &&
          row.y > 120 &&
          row.y < window.innerHeight - 8 &&
          row.title &&
          row.title.length <= 120 &&
          !["我的空间", "智能体", "新分组", "新建对话"].includes(row.title)
      )
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
      .slice(0, 8);

    const originalUrl = location.href;
    for (const row of rows) {
      if (targets.length >= 8) break;
      row.element.scrollIntoView({ block: "center" });
      await sleep(700);
      row.element.click();
      await sleep(1800);
      if (isCurrentConversationUrl(location.href) && !seen.has(location.href)) {
        seen.add(location.href);
        targets.push({ platform: id, url: location.href, title: row.title });
      }
    }

    if (location.href !== originalUrl) history.pushState(null, "", originalUrl);
    return targets;
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

  async function reportDiscoveryProgress(progress, runId) {
    await sendRuntimeMessage({ type: "AIHR_QWEN_DISCOVERY_PROGRESS", runId, progress }).catch(() => undefined);
  }

  async function requestSessionApi(path, data) {
    const cookieValue = (name) =>
      document.cookie
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([key]) => key === name)?.[1] || "";
    const ut =
      window.localStorage.getItem("uc-stat-dn") ||
      cookieValue("b-user-id") ||
      cookieValue("cna") ||
      window.sessionStorage.getItem("report_storage_utdId") ||
      crypto.randomUUID().replaceAll("-", "");
    const query = new URLSearchParams({
      ut,
      biz_id: "ai_qwen",
      chat_client: "h5",
      device: "pc",
      fr: navigator.userAgent.includes("Mac") ? "mac" : "pc",
      pr: "qwen",
      la: navigator.language || "zh-CN",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      wv: "3.9.1",
      sign_type: "2"
    });
    const response = await fetch(`https://chat2-api.qianwen.com${path}?${query}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success === false) {
      throw new Error(
        `Qwen session API failed (${response.status}${payload?.code ? `/${payload.code}` : ""}${
          payload?.msg ? `: ${payload.msg}` : ""
        }).`
      );
    }
    return payload.data;
  }

  async function discoverViaApi(options, runId) {
    const targets = [];
    const seen = new Set();
    const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker(options);
    let shouldStop = false;
    const addItems = (items) => {
      for (const item of Array.isArray(items) ? items : []) {
        const sessionId = clean(item?.session_id);
        if (!sessionId || seen.has(sessionId)) continue;
        seen.add(sessionId);
        const target = {
          platform: id,
          title: clean(item?.title) || "Qwen conversation",
          url: `https://www.qianwen.com/chat/${sessionId}`
        };
        const decision = tracker.consider(target);
        if (decision.include) targets.push(target);
        if (decision.stop) {
          shouldStop = true;
          break;
        }
      }
    };

    await reportDiscoveryProgress(
      { platform: id, phase: "requesting_session_api", targetsFound: 0, scannedTitles: 0 },
      runId
    );

    const topData = await requestSessionApi("/api/v1/session/top/list", {
      sort_field: "modifiedTime",
      need_show_chat_list: true
    });
    addItems(Array.isArray(topData) ? topData : topData?.list);

    let nextToken = "";
    let page = 0;
    while (!shouldStop && page < 60) {
      const pageData = await requestSessionApi("/api/v2/session/page/list", {
        limit: 50,
        next_token: nextToken,
        sort_field: "modifiedTime",
        need_filter_tag: true
      });
      addItems(pageData?.list);
      nextToken = clean(pageData?.next_token);
      page += 1;
      await reportDiscoveryProgress(
        {
          platform: id,
          phase: "paging_session_api",
          scrollIndex: page,
          targetsFound: targets.length,
          scannedTitles: targets.length
        },
        runId
      );
      if (nextToken && !shouldStop) await sleep(1600 + Math.floor(Math.random() * 900));
      if (!nextToken) break;
    }

    const trackerStats = tracker.stats();
    const stopReason = trackerStats.stopReason || (!nextToken ? "api_exhausted" : "max_items");
    return {
      ok: true,
      platform: id,
      targets,
      scannedTitles: targets.map((target) => target.title),
      failures: [],
      scrollsPerformed: page,
      stopReason,
      exhausted: !nextToken,
      exhaustive: options.mode !== "incremental" && !nextToken,
      discoveryMethod: "session_api",
      incremental: trackerStats
    };
  }

  async function discoverInPage(options = {}) {
    const runId = typeof options.runId === "string" ? options.runId : null;
    if (options.preferSessionApi !== false) {
      try {
        return await discoverViaApi(options, runId);
      } catch (error) {
        await reportDiscoveryProgress(
          {
            platform: id,
            phase: "session_api_fallback",
            error: error instanceof Error ? error.message : "Qwen session API failed."
          },
          runId
        );
      }
    }

    const maxItems = Math.min(Math.max(Number(options.maxItems) || 1000, 1), 3000);
    const maxScrolls = Math.min(Math.max(Number(options.maxScrolls) || 200, 1), 600);
    const delayMs = Math.min(Math.max(Number(options.delayMs) || 3200, 1200), 30000);
    const stopAfterNoNewScrolls = Math.min(Math.max(Number(options.stopAfterNoNewScrolls) || 8, 2), 30);
    const targets = [];
    const failures = [];
    const scannedTitles = [];
    const attemptedTitles = new Set();
    const seenUrls = new Set();
    const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker(options);
    const knownTargetsByTitle =
      typeof options.knownTargetsByTitle === "object" && options.knownTargetsByTitle !== null
        ? options.knownTargetsByTitle
        : {};
    let noNewScrolls = 0;
    let scrollsPerformed = 0;
    let requestedScrollTop = 0;
    let reachedEnd = false;
    let stopReason = "max_scrolls";

    for (let scrollIndex = 0; scrollIndex < maxScrolls && targets.length < maxItems; scrollIndex += 1) {
      const scannedBefore = scannedTitles.length;
      const rows = getVisibleHistoryRows();

      for (const row of rows) {
        if (targets.length >= maxItems) break;
        if (!row.title || attemptedTitles.has(row.title)) continue;
        attemptedTitles.add(row.title);
        scannedTitles.push(row.title);

        const knownTarget = knownTargetsByTitle[row.title];
        if (knownTarget?.url && !seenUrls.has(knownTarget.url)) {
          seenUrls.add(knownTarget.url);
          const decision = tracker.consider({ platform: id, url: knownTarget.url, title: row.title });
          if (decision.include) targets.push({ platform: id, url: knownTarget.url, title: row.title });
          if (decision.stop) {
            stopReason = tracker.stats().stopReason || "known_streak";
            break;
          }
          continue;
        }

        await reportDiscoveryProgress(
          {
            platform: id,
            phase: "clicking_row",
            scrollIndex,
            maxScrolls,
            currentTitle: row.title,
            targetsFound: targets.length,
            scannedTitles: scannedTitles.length,
            failures: failures.length
          },
          runId
        );

        try {
          const clicked = await clickHistoryRow(row.key, row.title);
          if (!clicked?.ok || !clicked.target?.url) {
            throw new Error(clicked?.error || "Qwen row did not return a target URL.");
          }
          if (!seenUrls.has(clicked.target.url)) {
            seenUrls.add(clicked.target.url);
            const decision = tracker.consider(clicked.target);
            if (decision.include) targets.push(clicked.target);
            if (decision.stop) stopReason = tracker.stats().stopReason || "known_streak";
          }
          if (options.restoreAfterClick === true) {
            await navigateBackWithSignal();
            scrollHistoryTo(requestedScrollTop);
          }
        } catch (error) {
          failures.push({
            platform: id,
            title: row.title,
            error: error instanceof Error ? error.message : "Qwen row discovery failed."
          });
        }

        await sleep(delayMs + Math.floor(Math.random() * Math.max(400, delayMs * 0.5)));
        if (tracker.stats().stopped) break;
      }

      if (tracker.stats().stopped) break;
      noNewScrolls = scannedTitles.length === scannedBefore ? noNewScrolls + 1 : 0;
      if (targets.length >= maxItems) {
        stopReason = "max_items";
        break;
      }

      requestedScrollTop += 720;
      const scroll = scrollHistoryTo(requestedScrollTop);
      scrollsPerformed = scrollIndex + 1;
      reachedEnd = scroll.atEnd;
      await reportDiscoveryProgress(
        {
          platform: id,
          phase: "scrolling_history",
          scrollIndex,
          maxScrolls,
          targetsFound: targets.length,
          scannedTitles: scannedTitles.length,
          failures: failures.length,
          scrollBefore: scroll.before,
          scrollAfter: scroll.after,
          scrollMoved: scroll.moved,
          scrollAtEnd: scroll.atEnd
        },
        runId
      );

      if (!scroll.moved && !scroll.atEnd) {
        failures.push({ platform: id, title: "history_scroll", error: "Qwen history list did not move." });
        stopReason = "scroll_stalled";
        break;
      }
      if (reachedEnd && noNewScrolls >= stopAfterNoNewScrolls) {
        stopReason = "no_new_targets";
        break;
      }
      if (!reachedEnd && noNewScrolls >= stopAfterNoNewScrolls) {
        failures.push({
          platform: id,
          title: "history_scroll",
          error: "Qwen history discovery stopped before the sidebar reached its end."
        });
        stopReason = "scroll_stalled";
        break;
      }
      await sleep(reachedEnd ? Math.max(delayMs, 5000) : delayMs);
    }

    return {
      ok: true,
      platform: id,
      targets,
      failures,
      scannedTitles,
      stopReason,
      scrollsPerformed,
      exhaustive:
        options.mode !== "incremental" && stopReason === "no_new_targets" && reachedEnd && failures.length === 0,
      incremental: tracker.stats()
    };
  }

  function discover(options = {}, request = {}) {
    if (request.stepDiscovery === true) return discoverInPage(options);
    return discoverHistory({
      platform: id,
      options,
      discoverLinkedHistory,
      getScrollElement,
      clickDiscovery: clickDiscoverVisibleRows,
      discoverScannedTitles: discoverVisibleHistoryTitles
    });
  }

  function serializeRows() {
    return getVisibleHistoryRows().map(({ key, title, x, y, width, height }) => ({ key, title, x, y, width, height }));
  }

  function diagnostics(request = {}) {
    if (request.action === "isConversationUrl") return isCurrentConversationUrl(request.url);
    if (request.action === "listDiagnostics") {
      const scrollElement = getScrollElement();
      const indexes = [...document.querySelectorAll("[data-react-window-index]")]
        .map((element) => Number(element.getAttribute("data-react-window-index")))
        .filter(Number.isFinite);
      return {
        ok: true,
        url: location.href,
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
        clientHeight: scrollElement.clientHeight,
        maxIndex: indexes.length ? Math.max(...indexes) : -1
      };
    }
    if (request.action === "prepareHistory") return { ok: true, scroll: scrollHistoryTo(0) };
    if (request.action === "visibleRows") {
      return { ok: true, platform: request.platform || id, rows: serializeRows() };
    }
    if (request.action === "clickHistoryRow") {
      return clickGenericHistoryRow({
        platform: request.platform || id,
        getRows: getVisibleHistoryRows,
        isCurrentConversationUrl,
        rowKey: request.rowKey,
        title: request.title
      });
    }
    if (request.action === "stepClickHistoryRow") return clickHistoryRow(request.rowKey, request.title);
    if (request.action === "stepScrollHistory") return scrollHistory(request.amount);
    if (request.action === "scrollHistory") {
      getScrollElement().scrollBy({ top: request.amount || 720, behavior: "smooth" });
      return { ok: true };
    }
    return { ok: true, platform: id, url: location.href, conversation: isCurrentConversationUrl(location.href) };
  }

  globalThis.AIHR_PLATFORMS.register({ id, matches, discover, extract, diagnostics });
})();
