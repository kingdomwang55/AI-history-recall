(() => {
const EXTENSION_VERSION = "0.1.38";
const EXTENSION_BUILD_ID = "no-debugger-input-20260711";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function platformFromUrl(url) {
  const host = new URL(url).hostname;
  if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
  if (host === "gemini.google.com") return "gemini";
  if (host === "chat.deepseek.com") return "deepseek";
  if (host === "www.qianwen.com" || host === "qianwen.com") return "qwen";
  return null;
}

function isLocalAppUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.port === "3000";
  } catch {
    return false;
  }
}

function textFrom(element) {
  return clean(element?.innerText || element?.textContent || "");
}

function extractChatGpt(messages) {
  document.querySelectorAll("[data-message-author-role]").forEach((element) => {
    const content = textFrom(element);
    if (content) {
      messages.push({
        role: element.getAttribute("data-message-author-role") || "unknown",
        content
      });
    }
  });
}

function extractGemini(messages) {
  document.querySelectorAll("user-query, message-content").forEach((element) => {
    const content = textFrom(element);
    if (content && !/^Sources\s*$/i.test(content)) {
      messages.push({
        role: element.tagName.toLowerCase() === "user-query" ? "user" : "assistant",
        content
      });
    }
  });
}

function extractDeepSeek(messages) {
  document.querySelectorAll(".ds-message").forEach((element) => {
    const assistant = element.querySelector(".ds-assistant-message-main-content");
    let content = textFrom(assistant || element);
    content = content.replace(/^已思考[\s\S]*?(?=\n\n|$)/, "").trim();
    if (content) {
      messages.push({
        role: assistant ? "assistant" : "user",
        content
      });
    }
  });
}

function extractQwen(messages) {
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
}

function conversationPathPattern(platform) {
  if (platform === "chatgpt") return /\/c\/[a-zA-Z0-9-]+/;
  if (platform === "gemini") return /\/app\/[a-zA-Z0-9_-]+/;
  if (platform === "deepseek") return /\/a\/chat\/s\/[a-zA-Z0-9_-]+/;
  if (platform === "qwen") return /\/chat\/[a-zA-Z0-9_-]+/;
  return /$a/;
}

function isConversationUrl(platform, url) {
  try {
    const parsed = new URL(url);
    if (platformFromUrl(parsed.href) !== platform) return false;
    return conversationPathPattern(platform).test(parsed.pathname);
  } catch {
    return false;
  }
}

function discoverLinkedHistory(platform) {
  const origin = location.origin;
  const targets = [];

  document.querySelectorAll("a[href]").forEach((element) => {
    const href = element.getAttribute("href") || "";
    const url = href.startsWith("http") ? href : new URL(href, origin).toString();
    if (!isConversationUrl(platform, url)) return;

    const title = clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
    targets.push({ platform, url, title: title || url });
  });

  return targets;
}

async function discoverChatGptHistoryViaApi(options = {}) {
  const maxItems = Math.min(Math.max(Number(options.maxItems) || 1000, 1), 3000);
  const limit = 100;
  const targets = [];
  const scannedTitles = [];
  const seen = new Set();
  let stopReason = "api_exhausted";

  for (let offset = 0; offset < maxItems; offset += limit) {
    const response = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`, {
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`ChatGPT conversations API failed (${response.status}).`);
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.conversations) ? data.conversations : [];
    if (items.length === 0) break;

    for (const item of items) {
      const id = clean(item.id || item.conversation_id || item.conversationId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const title = clean(item.title || item.name || "");
      if (title) scannedTitles.push(title);
      targets.push({
        platform: "chatgpt",
        url: `${location.origin}/c/${id}`,
        title: title || `${location.origin}/c/${id}`
      });
      if (targets.length >= maxItems) {
        stopReason = "max_items";
        break;
      }
    }

    if (targets.length >= maxItems || items.length < limit) break;
    await sleep(900 + Math.floor(Math.random() * 700));
  }

  return {
    ok: true,
    platform: "chatgpt",
    targets: targets.slice(0, maxItems),
    stopReason,
    scrollsPerformed: 0,
    scannedTitles: [...new Set(scannedTitles)].slice(0, maxItems + 200),
    exhaustive: stopReason === "api_exhausted"
  };
}

function discoverVisibleHistoryTitles() {
  const titles = [...document.querySelectorAll("a, button, div")]
    .map((element) => clean(element.innerText || element.textContent || element.getAttribute("aria-label") || ""))
    .filter((title) => title && title.length <= 140)
    .filter((title) => !["我的空间", "智能体", "新分组", "新建对话"].includes(title));

  return [...new Set(titles)].slice(0, 120);
}

function getQwenVisibleHistoryRows() {
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

function getGeminiVisibleHistoryRows() {
  const excluded = new Set([
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
        !excluded.has(normalized)
      );
    })
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
    .slice(0, 24);
}

function getGenericVisibleHistoryRows() {
  const excluded = new Set([
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
        !excluded.has(normalized)
      );
    })
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.title === row.title) === index)
    .slice(0, 28);
}

function getVisibleHistoryRows(platform) {
  if (platform === "gemini") return getGeminiVisibleHistoryRows();
  if (platform === "qwen") return getQwenVisibleHistoryRows();
  if (platform === "chatgpt" || platform === "deepseek") return getGenericVisibleHistoryRows();
  return [];
}

function getQwenHistoryScrollElement() {
  for (const row of getQwenVisibleHistoryRows()) {
    let element = row.element.parentElement;
    while (element && element !== document.body) {
      if (element.scrollHeight > element.clientHeight + 80) {
        return element;
      }
      element = element.parentElement;
    }
  }

  return getHistoryScrollElement("qwen");
}

function getPlatformHistoryScrollElement(platform) {
  const rows = getVisibleHistoryRows(platform);
  for (const row of rows) {
    let element = row.element.parentElement;
    while (element && element !== document.body) {
      if (element.scrollHeight > element.clientHeight + 80) {
        return element;
      }
      element = element.parentElement;
    }
  }

  return getHistoryScrollElement(platform);
}

async function clickHistoryRow(platform, rowKey, title) {
  const rows = getVisibleHistoryRows(platform);
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
    if (location.href !== originalUrl && isConversationUrl(platform, location.href)) {
      return {
        ok: true,
        target: {
          platform,
          url: location.href,
          title: row.title
        }
      };
    }
  }

  if (isConversationUrl(platform, location.href)) {
    return {
      ok: true,
      target: {
        platform,
        url: location.href,
        title: row.title
      }
    };
  }

  return { ok: false, error: `Click did not open a ${platform} conversation. Current URL: ${location.href}` };
}

async function clickQwenHistoryRow(rowKey, title) {
  const rows = getQwenVisibleHistoryRows();
  const row = rows.find((candidate) => candidate.key === rowKey) || rows.find((candidate) => candidate.title === title);
  if (!row) {
    return { ok: false, error: "Qwen history row is no longer visible." };
  }

  const originalUrl = location.href;
  const clickTarget = clickableHistoryElement(row.element);
  clickTarget.click();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(400);
    if (location.href !== originalUrl && isConversationUrl("qwen", location.href)) {
      return {
        ok: true,
        target: {
          platform: "qwen",
          url: location.href,
          title: row.title
        }
      };
    }
  }

  if (isConversationUrl("qwen", location.href)) {
    return {
      ok: true,
      target: {
        platform: "qwen",
        url: location.href,
        title: row.title
      }
    };
  }

  return { ok: false, error: `Click did not open a Qwen conversation. Current URL: ${location.href}` };
}

function scrollQwenHistory(amount = 720) {
  const scrollElement = getQwenHistoryScrollElement();
  const before = scrollElement.scrollTop;
  return setQwenHistoryScrollTop(scrollElement, before + amount);
}

function scrollQwenHistoryTo(targetTop) {
  return setQwenHistoryScrollTop(getQwenHistoryScrollElement(), targetTop);
}

function setQwenHistoryScrollTop(scrollElement, targetTop) {
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

function getHistoryScrollElement(platform) {
  const selectors = [
    "nav",
    "aside",
    "[class*=sidebar]",
    "[class*=sider]",
    "[class*=history]",
    "[class*=conversation]",
    "[class*=session]"
  ];
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
          (platform === "qwen" && String(element.className || "").toLowerCase().includes("sidebar") ? 4 : 0) +
          Math.min(6, Math.floor((element.innerText || "").length / 600))
      }))
      .sort((a, b) => b.score - a.score)[0]?.element || document.scrollingElement || document.documentElement
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickDiscoverQwenVisibleRows(seen) {
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
    if (isConversationUrl("qwen", location.href) && !seen.has(location.href)) {
      seen.add(location.href);
      targets.push({ platform: "qwen", url: location.href, title: row.title });
    }
  }

  if (location.href !== originalUrl) {
    history.pushState(null, "", originalUrl);
  }

  return targets;
}

async function reportQwenDiscoveryProgress(progress, runId) {
  await sendRuntimeMessage({ type: "AIHR_QWEN_DISCOVERY_PROGRESS", runId, progress }).catch(() => undefined);
}

async function requestQwenSessionApi(path, data) {
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

async function discoverQwenHistoryViaApi(options, runId) {
  const maxItems = Math.min(Math.max(Number(options.maxItems) || 3000, 1), 3000);
  const targets = [];
  const seen = new Set();
  const addItems = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const sessionId = clean(item?.session_id);
      if (!sessionId || seen.has(sessionId)) continue;
      seen.add(sessionId);
      targets.push({
        platform: "qwen",
        title: clean(item?.title) || "Qwen conversation",
        url: `https://www.qianwen.com/chat/${sessionId}`
      });
      if (targets.length >= maxItems) break;
    }
  };

  await reportQwenDiscoveryProgress(
    { platform: "qwen", phase: "requesting_session_api", targetsFound: 0, scannedTitles: 0 },
    runId
  );

  const topData = await requestQwenSessionApi("/api/v1/session/top/list", {
    sort_field: "modifiedTime",
    need_show_chat_list: true
  });
  addItems(Array.isArray(topData) ? topData : topData?.list);

  let nextToken = "";
  let page = 0;
  do {
    const pageData = await requestQwenSessionApi("/api/v2/session/page/list", {
      limit: 50,
      next_token: nextToken,
      sort_field: "modifiedTime",
      need_filter_tag: true
    });
    addItems(pageData?.list);
    nextToken = clean(pageData?.next_token);
    page += 1;
    await reportQwenDiscoveryProgress(
      {
        platform: "qwen",
        phase: "paging_session_api",
        scrollIndex: page,
        targetsFound: targets.length,
        scannedTitles: targets.length
      },
      runId
    );
    if (nextToken && targets.length < maxItems) await sleep(1600 + Math.floor(Math.random() * 900));
  } while (nextToken && targets.length < maxItems && page < 60);

  return {
    ok: true,
    platform: "qwen",
    targets,
    scannedTitles: targets.map((target) => target.title),
    failures: [],
    scrollsPerformed: page,
    stopReason: targets.length >= maxItems ? "max_items" : "no_new_targets",
    exhausted: !nextToken,
    exhaustive: !nextToken,
    discoveryMethod: "session_api"
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

async function discoverQwenHistoryInPage(options = {}) {
  const runId = typeof options.runId === "string" ? options.runId : null;
  if (options.preferSessionApi !== false) {
    try {
      return await discoverQwenHistoryViaApi(options, runId);
    } catch (error) {
      await reportQwenDiscoveryProgress(
        {
          platform: "qwen",
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
    const rows = getQwenVisibleHistoryRows();

    for (const row of rows) {
      if (targets.length >= maxItems) break;
      if (!row.title || attemptedTitles.has(row.title)) continue;
      attemptedTitles.add(row.title);
      scannedTitles.push(row.title);

      const knownTarget = knownTargetsByTitle[row.title];
      if (knownTarget?.url && !seenUrls.has(knownTarget.url)) {
        seenUrls.add(knownTarget.url);
        targets.push({ platform: "qwen", url: knownTarget.url, title: row.title });
        continue;
      }

      await reportQwenDiscoveryProgress({
        platform: "qwen",
        phase: "clicking_row",
        scrollIndex,
        maxScrolls,
        currentTitle: row.title,
        targetsFound: targets.length,
        scannedTitles: scannedTitles.length,
        failures: failures.length
      }, runId);

      try {
        const clicked = await clickQwenHistoryRow(row.key, row.title);
        if (!clicked?.ok || !clicked.target?.url) {
          throw new Error(clicked?.error || "Qwen row did not return a target URL.");
        }
        if (!seenUrls.has(clicked.target.url)) {
          seenUrls.add(clicked.target.url);
          targets.push(clicked.target);
        }
        if (options.restoreAfterClick === true) {
          await navigateBackWithSignal();
          scrollQwenHistoryTo(requestedScrollTop);
        }
      } catch (error) {
        failures.push({
          platform: "qwen",
          title: row.title,
          error: error instanceof Error ? error.message : "Qwen row discovery failed."
        });
      }

      await sleep(delayMs + Math.floor(Math.random() * Math.max(400, delayMs * 0.5)));
    }

    noNewScrolls = scannedTitles.length === scannedBefore ? noNewScrolls + 1 : 0;
    if (targets.length >= maxItems) {
      stopReason = "max_items";
      break;
    }

    requestedScrollTop += 720;
    const scroll = scrollQwenHistoryTo(requestedScrollTop);
    scrollsPerformed = scrollIndex + 1;
    reachedEnd = scroll.atEnd;
    await reportQwenDiscoveryProgress({
      platform: "qwen",
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
    }, runId);

    if (!scroll.moved && !scroll.atEnd) {
      failures.push({ platform: "qwen", title: "history_scroll", error: "Qwen history list did not move." });
      stopReason = "scroll_stalled";
      break;
    }
    if (reachedEnd && noNewScrolls >= stopAfterNoNewScrolls) {
      stopReason = "no_new_targets";
      break;
    }
    if (!reachedEnd && noNewScrolls >= stopAfterNoNewScrolls) {
      failures.push({
        platform: "qwen",
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
    platform: "qwen",
    targets,
    failures,
    scannedTitles,
    stopReason,
    scrollsPerformed,
    exhaustive: stopReason === "no_new_targets" && reachedEnd && failures.length === 0
  };
}

async function discoverHistory(options = {}) {
  const platform = platformFromUrl(location.href);
  if (!platform) {
    return { ok: false, error: "Unsupported page.", targets: [] };
  }

  if (platform === "chatgpt") {
    try {
      const apiDiscovery = await discoverChatGptHistoryViaApi(options);
      if (apiDiscovery.targets.length > 0) return apiDiscovery;
    } catch {
      // Fall back to sidebar DOM discovery when the private same-origin list is unavailable.
    }
  }

  const maxItems = Math.min(Math.max(Number(options.maxItems) || 1000, 1), 3000);
  const maxScrolls = Math.min(Math.max(Number(options.maxScrolls) || 200, 1), 600);
  const delayMs = Math.min(Math.max(Number(options.delayMs) || 3200, 1200), 30000);
  const stopAfterNoNewScrolls = Math.min(Math.max(Number(options.stopAfterNoNewScrolls) || 8, 2), 30);
  const seen = new Set();
  const targets = [];
  let noNewScrolls = 0;
  let stopReason = "max_scrolls";
  let scrollsPerformed = 0;
  const scrollElement = getHistoryScrollElement(platform);

  for (let index = 0; index < maxScrolls && targets.length < maxItems; index += 1) {
    const before = targets.length;
    const discovered = discoverLinkedHistory(platform);

    for (const target of discovered) {
      if (seen.has(target.url)) continue;
      seen.add(target.url);
      targets.push(target);
      if (targets.length >= maxItems) break;
    }

    if (platform === "qwen" && options.enableClickDiscovery === true && targets.length < maxItems) {
      for (const target of await clickDiscoverQwenVisibleRows(seen)) {
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
    scannedTitles:
      platform === "qwen"
        ? discoverVisibleHistoryTitles()
        : targets.map((target) => target.title).filter(Boolean),
    exhaustive: stopReason === "no_new_targets"
  };
}

async function extractConversation() {
  const platform = platformFromUrl(location.href);
  const messages = [];

  if (platform === "chatgpt") extractChatGpt(messages);
  if (platform === "gemini") extractGemini(messages);
  if (platform === "deepseek") extractDeepSeek(messages);
  if (platform === "qwen") extractQwen(messages);

  return {
    platform,
    url: location.href,
    title: document.title,
    messages
  };
}

window.__AI_HISTORY_RECALL_EXTENSION__ = {
  platform: platformFromUrl(location.href),
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

    if (message.type === "AIHR_WEB_START_CAPTURE") {
      const plan = message.plan || {};
      const runtimeMessage = {
        type: "AIHR_START_ALL_PLATFORMS_CAPTURE",
        sourceTabId: undefined,
        options: {
          maxItems: plan.maxItems,
          maxScrolls: plan.maxScrolls,
          delayMs: plan.delayMs,
          stopAfterNoNewScrolls: plan.stopAfterNoNewScrolls,
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
      platform: platformFromUrl(location.href),
      url: location.href
    });
    return true;
  }

  if (message?.type === "AIHR_QWEN_LIST_DIAGNOSTICS") {
    const scrollElement = getQwenHistoryScrollElement();
    const indexes = [...document.querySelectorAll("[data-react-window-index]")]
      .map((element) => Number(element.getAttribute("data-react-window-index")))
      .filter(Number.isFinite);
    sendResponse({
      ok: true,
      url: location.href,
      scrollTop: scrollElement.scrollTop,
      scrollHeight: scrollElement.scrollHeight,
      clientHeight: scrollElement.clientHeight,
      maxIndex: indexes.length ? Math.max(...indexes) : -1
    });
    return true;
  }

  if (message?.type === "AIHR_QWEN_PREPARE_HISTORY") {
    sendResponse({ ok: true, scroll: scrollQwenHistoryTo(0) });
    return true;
  }

  if (message?.type === "AIHR_CAPTURE_CURRENT") {
    extractConversation()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Capture failed."
        })
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
    discoverQwenHistoryInPage(message.options)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          platform: "qwen",
          error: error instanceof Error ? error.message : "Qwen discovery failed.",
          targets: [],
          failures: []
        })
      );
    return true;
  }

  if (message?.type === "AIHR_QWEN_VISIBLE_ROWS") {
    sendResponse({
      ok: true,
      platform: "qwen",
      rows: getQwenVisibleHistoryRows().map(({ key, title, x, y, width, height }) => ({
        key,
        title,
        x,
        y,
        width,
        height
      }))
    });
    return true;
  }

  if (message?.type === "AIHR_QWEN_CLICK_ROW") {
    clickQwenHistoryRow(message.rowKey, message.title)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Qwen row click failed."
        })
      );
    return true;
  }

  if (message?.type === "AIHR_QWEN_SCROLL_HISTORY") {
    try {
      sendResponse(scrollQwenHistory(message.amount));
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Qwen history scroll failed."
      });
    }
    return true;
  }

  if (message?.type === "AIHR_VISIBLE_HISTORY_ROWS") {
    const platform = message.platform || platformFromUrl(location.href);
    sendResponse({
      ok: true,
      platform,
      rows: getVisibleHistoryRows(platform).map(({ key, title, x, y, width, height }) => ({
        key,
        title,
        x,
        y,
        width,
        height
      }))
    });
    return true;
  }

  if (message?.type === "AIHR_CLICK_HISTORY_ROW") {
    const platform = message.platform || platformFromUrl(location.href);
    clickHistoryRow(platform, message.rowKey, message.title)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "History row click failed."
        })
      );
    return true;
  }

  if (message?.type === "AIHR_SCROLL_HISTORY") {
    try {
      const platform = message.platform || platformFromUrl(location.href);
      const scrollElement = getPlatformHistoryScrollElement(platform);
      scrollElement.scrollBy({ top: message.amount || 720, behavior: "smooth" });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "History scroll failed."
      });
    }
    return true;
  }

  return false;
});
})();
