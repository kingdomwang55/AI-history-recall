import type { CapturePlatform, CapturePlatformConfig } from "./types";

const commonRateLimit = {
  pageDelayMs: 3600,
  pageJitterMs: 2600,
  afterScrollDelayMs: 1000
};

const chatGptExtractor = `
(() => {
  const clean = (value) => String(value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  return [...document.querySelectorAll("[data-message-author-role]")]
    .map((element, index) => ({
      role: element.getAttribute("data-message-author-role") || "unknown",
      content: clean(element.innerText || element.textContent),
      orderIndex: index
    }))
    .filter((message) => message.content.length > 0);
})()
`;

const geminiExtractor = `
(() => {
  const clean = (value) => String(value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  return [...document.querySelectorAll("user-query, message-content")]
    .map((element, index) => ({
      role: element.tagName.toLowerCase() === "user-query" ? "user" : "assistant",
      content: clean(element.innerText || element.textContent),
      orderIndex: index
    }))
    .filter((message) => message.content.length > 0 && !/^Sources\\s*$/i.test(message.content));
})()
`;

const deepSeekExtractor = `
(() => {
  const clean = (value) => String(value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  return [...document.querySelectorAll(".ds-message")]
    .map((element, index) => {
      const assistant = element.querySelector(".ds-assistant-message-main-content");
      const role = assistant ? "assistant" : "user";
      let content = clean((assistant || element).innerText || (assistant || element).textContent);
      content = content.replace(/^已思考[\\s\\S]*?(?=\\n\\n|$)/, "").trim();
      return { role, content, orderIndex: index };
    })
    .filter((message) => message.content.length > 0);
})()
`;

const qwenExtractor = `
(() => {
  const clean = (value) => String(value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  const rounds = [...document.querySelectorAll(".chat-round")];
  if (rounds.length > 0) {
    const messages = [];
    for (const round of rounds) {
      const question = round.querySelector(
        "[class*=question-text-card], [class*=wrapper-question], [class*=chat-question], [class*=question]"
      );
      const answer = round.querySelector(
        "[class*=markdown], [class*=answerItem], [class*=wrapper-answer], [class*=answer]"
      );
      const questionText = clean(question?.innerText || question?.textContent || "");
      const answerText = clean(answer?.innerText || answer?.textContent || "");
      if (questionText) messages.push({ role: "user", content: questionText, orderIndex: messages.length });
      if (answerText) messages.push({ role: "assistant", content: answerText, orderIndex: messages.length });
    }
    return messages;
  }

  const cards = [...document.querySelectorAll("[class*=question], [class*=answer], [class*=markdown], [class*=message]")]
    .map((element) => ({
      className: String(element.className || ""),
      content: clean(element.innerText || element.textContent)
    }))
    .filter((item) => item.content.length > 0 && item.content.length < 50000);

  const messages = [];
  for (const item of cards) {
    const role = /question|user/i.test(item.className)
      ? "user"
      : /answer|assistant|markdown/i.test(item.className)
        ? "assistant"
        : "unknown";
    if (!messages.some((message) => message.content === item.content || item.content.includes(message.content))) {
      messages.push({ role, content: item.content, orderIndex: messages.length });
    }
  }
  return messages.slice(0, 30);
})()
`;

const linkedHistoryExtractor = `
(() => {
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const origin = location.origin;

  return [...document.querySelectorAll("a[href]")]
    .map((element) => {
      const href = element.getAttribute("href") || "";
      const url = href.startsWith("http") ? href : new URL(href, origin).toString();
      return {
        url,
        title: clean(element.innerText || element.textContent || element.getAttribute("aria-label") || "")
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, 250);
})()
`;

const qwenHistoryExtractor = `
(() => {
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();

  return [...document.querySelectorAll("div")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        title: clean(element.innerText || element.textContent),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })
    .filter((row) =>
      row.x === 12 &&
      row.width >= 220 &&
      row.height >= 34 &&
      row.height <= 38 &&
      row.y > 290 &&
      row.y < window.innerHeight - 8 &&
      row.title &&
      !["我的空间", "智能体", "新分组"].includes(row.title)
    )
    .filter((row, index, rows) =>
      rows.findIndex((candidate) => candidate.title === row.title && Math.abs(candidate.y - row.y) < 2) === index
    )
    .slice(0, 12);
})()
`;

export const capturePlatformConfigs: Record<CapturePlatform, CapturePlatformConfig> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    historyUrl: "https://chatgpt.com/",
    defaultTags: ["chrome-capture", "chatgpt"],
    rateLimit: commonRateLimit,
    hydrateScrolls: [
      { x: 900, y: 650, scrollY: 620 },
      { x: 900, y: 650, scrollY: -240 }
    ],
    extractor: chatGptExtractor,
    historyExtractor: linkedHistoryExtractor
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    hosts: ["gemini.google.com"],
    historyUrl: "https://gemini.google.com/app",
    defaultTags: ["chrome-capture", "gemini"],
    rateLimit: commonRateLimit,
    hydrateScrolls: [
      { x: 900, y: 650, scrollY: 620 },
      { x: 900, y: 650, scrollY: -240 }
    ],
    extractor: geminiExtractor,
    historyExtractor: linkedHistoryExtractor
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    hosts: ["chat.deepseek.com"],
    historyUrl: "https://chat.deepseek.com/",
    defaultTags: ["chrome-capture", "deepseek"],
    rateLimit: commonRateLimit,
    hydrateScrolls: [
      { x: 900, y: 650, scrollY: 620 },
      { x: 900, y: 650, scrollY: -240 }
    ],
    extractor: deepSeekExtractor,
    historyExtractor: linkedHistoryExtractor
  },
  qwen: {
    id: "qwen",
    label: "通义千问",
    hosts: ["www.qianwen.com", "qianwen.com"],
    historyUrl: "https://www.qianwen.com/",
    defaultTags: ["chrome-capture", "qwen"],
    rateLimit: {
      pageDelayMs: 4300,
      pageJitterMs: 2800,
      afterScrollDelayMs: 1600
    },
    hydrateScrolls: [
      { x: 140, y: 520, scrollY: 520, delayMs: 1600 }
    ],
    extractor: qwenExtractor,
    historyExtractor: qwenHistoryExtractor
  }
};

export function getCapturePlatformConfig(platform: CapturePlatform) {
  return capturePlatformConfigs[platform];
}

export function inferPlatformFromUrl(url: string): CapturePlatform | null {
  let host = "";

  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  for (const config of Object.values(capturePlatformConfigs)) {
    if (config.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return config.id;
    }
  }

  return null;
}
