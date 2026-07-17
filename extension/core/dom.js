(() => {
  function clean(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function textFrom(element) {
    return clean(element?.innerText || element?.textContent || "");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isConversationUrl(matches, pathPattern, url) {
    try {
      const parsed = new URL(url);
      return matches(parsed.href) && pathPattern.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function clickableHistoryElement(rowElement) {
    const directTarget = rowElement.querySelector?.(".cursor-pointer");
    if (directTarget) return directTarget;

    const rect = rowElement.getBoundingClientRect();
    const centerElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const candidates = [centerElement, rowElement].filter(Boolean);

    for (const candidate of candidates) {
      const clickable = candidate.closest?.("a, button, [role=button], [tabindex], [data-testid], [data-test-id]");
      if (clickable) return clickable;
    }

    let element = rowElement;
    while (element?.parentElement && element !== document.body) {
      const rect = element.getBoundingClientRect();
      if (rect.width >= rowElement.getBoundingClientRect().width && rect.height <= 96) {
        return element;
      }
      element = element.parentElement;
    }

    return rowElement;
  }

  function clickElementLikeUser(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) || element;
    if (typeof PointerEvent === "function") {
      for (const type of ["pointerdown", "pointerup"]) {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
          })
        );
      }
    }

    for (const type of ["mousedown", "mouseup"]) {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0
        })
      );
    }
    target.click();
  }

  function getHistoryScrollElement(selectors, preferredClassName = "") {
    const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    candidates.push(document.scrollingElement || document.documentElement);

    return (
      candidates
        .filter(Boolean)
        .map((element) => ({
          element,
          score:
            (element.scrollHeight > element.clientHeight + 80 ? 8 : 0) +
            (element.getBoundingClientRect().left < window.innerWidth * 0.45 ? 4 : 0) +
            (preferredClassName && String(element.className || "").toLowerCase().includes(preferredClassName) ? 4 : 0) +
            Math.min(6, Math.floor((element.innerText || "").length / 600))
        }))
        .sort((a, b) => b.score - a.score)[0]?.element ||
      document.scrollingElement ||
      document.documentElement
    );
  }

  async function clickHistoryRow({ platform, getRows, isCurrentConversationUrl, rowKey, title }) {
    const rows = getRows();
    const row = rows.find((candidate) => candidate.key === rowKey) || rows.find((candidate) => candidate.title === title);
    if (!row) {
      return { ok: false, error: `${platform} history row is no longer visible.` };
    }

    const originalUrl = location.href;
    row.element.scrollIntoView({ block: "center" });
    await sleep(500);
    clickElementLikeUser(clickableHistoryElement(row.element));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(500);
      if (location.href !== originalUrl && isCurrentConversationUrl(location.href)) {
        return {
          ok: true,
          target: { platform, url: location.href, title: row.title }
        };
      }
    }

    if (isCurrentConversationUrl(location.href)) {
      return {
        ok: true,
        target: { platform, url: location.href, title: row.title }
      };
    }

    return { ok: false, error: `Click did not open a ${platform} conversation. Current URL: ${location.href}` };
  }

  async function discoverHistory({
    platform,
    options = {},
    discoverLinkedHistory,
    getScrollElement,
    clickDiscovery,
    discoverScannedTitles
  }) {
    const maxItems = Math.min(Math.max(Number(options.maxItems) || 1000, 1), 3000);
    const maxScrolls = Math.min(Math.max(Number(options.maxScrolls) || 200, 1), 600);
    const delayMs = Math.min(Math.max(Number(options.delayMs) || 3200, 1200), 30000);
    const stopAfterNoNewScrolls = Math.min(Math.max(Number(options.stopAfterNoNewScrolls) || 8, 2), 30);
    const seen = new Set();
    const targets = [];
    const tracker = globalThis.AIHR_INCREMENTAL_SYNC.createTracker(options);
    let noNewScrolls = 0;
    let stopReason = "max_scrolls";
    let scrollsPerformed = 0;
    const scrollElement = getScrollElement();

    for (let index = 0; index < maxScrolls && targets.length < maxItems; index += 1) {
      const before = targets.length;
      const discovered = discoverLinkedHistory();

      for (const target of discovered) {
        if (seen.has(target.url)) continue;
        seen.add(target.url);
        const decision = tracker.consider(target);
        if (decision.include) targets.push(target);
        if (decision.stop) {
          stopReason = tracker.stats().stopReason || "max_items";
          break;
        }
      }

      if (tracker.stats().stopped) break;

      if (options.enableClickDiscovery === true && clickDiscovery && targets.length < maxItems) {
        for (const target of await clickDiscovery(seen)) {
          targets.push(target);
          if (targets.length >= maxItems) break;
        }
      }

      noNewScrolls = targets.length === before ? noNewScrolls + 1 : 0;
      if (noNewScrolls >= stopAfterNoNewScrolls) {
        stopReason = "no_new_targets";
        break;
      }

      scrollElement.scrollBy({ top: 720, behavior: "smooth" });
      scrollsPerformed += 1;
      await sleep(delayMs);
    }

    if (targets.length >= maxItems) stopReason = "max_items";

    return {
      ok: true,
      platform,
      targets: targets.slice(0, maxItems),
      stopReason,
      scrollsPerformed,
      scannedTitles: discoverScannedTitles
        ? discoverScannedTitles()
        : targets.map((target) => target.title).filter(Boolean),
      exhaustive: options.mode !== "incremental" && stopReason === "no_new_targets",
      incremental: tracker.stats()
    };
  }

  function navigateBackWithSignal() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener("popstate", finish);
        resolve();
      };
      window.addEventListener("popstate", finish, { once: true });
      history.back();
      setTimeout(finish, 4000);
    });
  }

  globalThis.AIHR_DOM = Object.freeze({
    clean,
    textFrom,
    sleep,
    isConversationUrl,
    clickableHistoryElement,
    clickHistoryRow,
    discoverHistory,
    getHistoryScrollElement,
    navigateBackWithSignal
  });
})();
