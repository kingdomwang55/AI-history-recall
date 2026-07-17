import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const platformFixtures = [
  {
    id: "chatgpt",
    url: "https://chatgpt.com/c/fixture",
    matchingUrls: ["https://chatgpt.com/c/fixture", "https://chat.openai.com/c/fixture"]
  },
  { id: "gemini", url: "https://gemini.google.com/app/fixture" },
  { id: "deepseek", url: "https://chat.deepseek.com/a/chat/s/fixture" },
  {
    id: "qwen",
    url: "https://www.qianwen.com/chat/fixture",
    matchingUrls: ["https://www.qianwen.com/chat/fixture", "https://qianwen.com/chat/fixture"]
  }
];

const voidElements = new Set(["br", "hr", "img", "input", "link", "meta"]);

function decodeEntities(value) {
  return value
    .replaceAll("&nbsp;", "\u00a0")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function matchesSelector(element, selector) {
  if (selector.startsWith(".")) {
    return (element.getAttribute("class") || "").split(/\s+/).includes(selector.slice(1));
  }

  if (selector.startsWith("[")) {
    const match = selector.match(/^\[([^=*\]]+)(?:([*]?=)([^\]]+))?\]$/);
    if (!match) return false;
    const value = element.getAttribute(match[1]);
    if (match[2] === undefined) return value !== null;
    const expected = match[3].replace(/^["']|["']$/g, "");
    return match[2] === "*=" ? value?.includes(expected) === true : value === expected;
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FixtureElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.parentElement = null;
  }

  append(child) {
    this.children.push(child);
    if (child instanceof FixtureElement) child.parentElement = this;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  get textContent() {
    return this.children
      .map((child) => (typeof child === "string" ? child : child.textContent))
      .join("");
  }

  get innerText() {
    return this.textContent;
  }

  querySelectorAll(selectorList) {
    const selectors = selectorList.split(",").map((selector) => selector.trim());
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (!(child instanceof FixtureElement)) continue;
        if (selectors.some((selector) => matchesSelector(child, selector))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selectorList) {
    return this.querySelectorAll(selectorList)[0] || null;
  }
}

function parseFixture(source) {
  const root = new FixtureElement("document");
  const stack = [root];
  const tokens = source.match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g) || [];

  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (!token.startsWith("<")) {
      stack.at(-1).append(decodeEntities(token));
      continue;
    }

    const tagMatch = token.match(/^<\s*([^\s/>]+)/);
    if (!tagMatch) continue;
    const attributes = {};
    const attributeSource = token.slice(tagMatch[0].length, token.lastIndexOf(">"));
    for (const match of attributeSource.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    const element = new FixtureElement(tagMatch[1], attributes);
    stack.at(-1).append(element);
    if (!token.endsWith("/>") && !voidElements.has(tagMatch[1].toLowerCase())) stack.push(element);
  }

  return root;
}

async function loadPlatformFixture(fixture) {
  const fixturePath = path.join(process.cwd(), "test", "fixtures", "extension", `${fixture.id}.html`);
  const adapterPath = path.join(process.cwd(), "extension", "platforms", `${fixture.id}.js`);
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const context = vm.createContext({
    URL,
    document: parseFixture(fs.readFileSync(fixturePath, "utf8")),
    location: new URL(fixture.url)
  });
  context.globalThis = context;

  for (const file of [
    "extension/platforms/registry.js",
    "extension/core/dom.js",
    "extension/incremental-sync.js"
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  vm.runInContext(adapterSource, context, { filename: `extension/platforms/${fixture.id}.js` });

  const adapter = context.AIHR_PLATFORMS.forUrl(fixture.url);
  assert.ok(adapter, `Expected ${fixture.id} adapter to match its fixture URL.`);
  return adapter;
}

function loadCoordinator(adapter) {
  let runtimeListener;
  const window = {
    setTimeout,
    postMessage() {}
  };
  const context = vm.createContext({
    URL,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, callback) {
          callback({ ok: true });
        },
        onMessage: {
          addListener(listener) {
            runtimeListener = listener;
          }
        }
      }
    },
    document: { body: {}, title: "Fixture conversation" },
    location: new URL("https://adapter.test/conversation"),
    MutationObserver: class {
      observe() {}
    },
    setTimeout,
    window
  });
  context.globalThis = context;
  context.AIHR_PLATFORMS = { forUrl: () => adapter };

  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "extension", "content.js"), "utf8"), context, {
    filename: "extension/content.js"
  });

  return {
    dispatch(message) {
      return new Promise((resolve) => runtimeListener(message, {}, resolve));
    }
  };
}

for (const fixture of platformFixtures) {
  test(`${fixture.id} extracts ordered user and assistant messages`, async () => {
    const adapter = await loadPlatformFixture(fixture);
    const result = await adapter.extract();

    assert.equal(adapter.id, fixture.id);
    for (const method of ["matches", "discover", "extract", "diagnostics"]) {
      assert.equal(typeof adapter[method], "function");
    }
    assert.deepEqual([...result.messages].map(({ role }) => role), ["user", "assistant"]);
    assert.ok(result.messages.every(({ content }) => content.length > 0));
    for (const url of fixture.matchingUrls || [fixture.url]) assert.equal(adapter.matches(url), true);
  });
}

test("content script delegates platform behavior without platform implementation details", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content.js"), "utf8");
  const implementationSource = source.replaceAll("deepseek-pinned-groups-20260715", "");

  assert.match(source, /AIHR_PLATFORMS\.forUrl\(location\.href\)/);
  assert.match(source, /adapter\.extract\(/);
  assert.match(source, /adapter\.discover\(/);
  assert.match(source, /adapter\.diagnostics\(/);
  assert.doesNotMatch(implementationSource, /chatgpt|gemini|deepseek|qwen|ds-message|chat-round/);
});

test("content coordinator delegates capture, discovery, step discovery, and diagnostics", async () => {
  const calls = [];
  const adapter = {
    id: "fixture",
    extract: async () => {
      calls.push(["extract"]);
      return {
        platform: "fixture",
        url: "https://adapter.test/conversation",
        title: "Delegated capture",
        messages: [
          { role: "user", content: "Keep this message." },
          { role: "assistant", content: "Keep this response." },
          { role: "assistant", content: "" },
          { role: null, content: "Reject this malformed message." }
        ]
      };
    },
    discover: async (options, request) => {
      calls.push(["discover", options, request]);
      return { ok: true, platform: "fixture", targets: [] };
    },
    diagnostics: (request) => {
      calls.push(["diagnostics", request]);
      if (request.action === "isConversationUrl") return true;
      return { ok: true, platform: "fixture", rows: [] };
    }
  };
  const coordinator = loadCoordinator(adapter);

  const capture = await coordinator.dispatch({ type: "AIHR_CAPTURE_CURRENT" });
  const discovery = await coordinator.dispatch({ type: "AIHR_DISCOVER_HISTORY", options: { mode: "incremental" } });
  const stepDiscovery = await coordinator.dispatch({
    type: "AIHR_DISCOVER_QWEN_HISTORY",
    options: { maxItems: 25 }
  });
  const diagnostics = await coordinator.dispatch({ type: "AIHR_VISIBLE_HISTORY_ROWS", platform: "fixture" });

  assert.deepEqual(capture.payload.messages.map(({ role }) => role), ["user", "assistant"]);
  assert.equal(discovery.ok, true);
  assert.equal(stepDiscovery.ok, true);
  assert.equal(diagnostics.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["extract"],
    ["discover", { mode: "incremental" }, {}],
    ["discover", { maxItems: 25 }, { stepDiscovery: true }],
    ["diagnostics", { action: "visibleRows", platform: "fixture" }]
  ]);
});

test("manifest and programmatic injection load adapters in the same order", () => {
  const expected = [
    "core/constants.js",
    "core/protocol.js",
    "platforms/registry.js",
    "core/dom.js",
    "platforms/chatgpt.js",
    "platforms/gemini.js",
    "platforms/deepseek.js",
    "platforms/qwen.js",
    "incremental-sync.js",
    "content.js"
  ];
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));
  const background = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");
  const match = background.match(/function injectContentScript\(tabId\) \{[\s\S]*?files: \[([\s\S]*?)\][\s\S]*?\n\}/);

  assert.ok(match);
  assert.deepEqual(manifest.content_scripts[0].js, expected);
  assert.deepEqual([...match[1].matchAll(/"([^"]+)"/g)].map((file) => file[1]), expected);
});
