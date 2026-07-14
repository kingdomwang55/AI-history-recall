import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("application shell exposes the enterprise workspace navigation", async () => {
  const layout = await source("src/app/layout.tsx");
  const navigation = await source("src/components/AppNavigation.tsx");
  const logo = await source("src/components/RecallLensLogo.tsx");

  assert.match(layout, /AppNavigation/);
  assert.match(navigation, /app-sidebar/);
  assert.match(navigation, /app-topbar/);
  assert.match(navigation, /本地模式/);
  assert.match(navigation, /搜索历史对话/);
  assert.match(navigation, /RecallLensLogo/);
  assert.doesNotMatch(navigation, /\bArchive\b/);
  assert.match(logo, /MessageCircle/);
  assert.match(logo, /RotateCcw/);
  assert.ok(navigation.indexOf('label: "采集"') < navigation.indexOf('label: "导入"'));
  assert.ok(navigation.indexOf('label: "搜索"') < navigation.indexOf('label: "导入"'));
});

test("search page uses a filter and result workspace", async () => {
  const page = await source("src/app/search/page.tsx");

  assert.match(page, /knowledge-workspace/);
  assert.match(page, /search-filter-panel/);
  assert.match(page, /search-filter-desktop/);
  assert.match(page, /search-filter-mobile/);
  assert.match(page, /search-result-list/);
  assert.match(page, /共 .* 条结果/);
  assert.match(page, /dateFrom/);
  assert.match(page, /dateTo/);
  assert.match(page, /search-control/);
  assert.doesNotMatch(page, /sticky top-\[var\(--topbar-height\)\]/);
});

test("search route removes the duplicate global search and platform badges include logos", async () => {
  const navigation = await source("src/components/AppNavigation.tsx");
  const badge = await source("src/components/PlatformBadge.tsx");

  assert.match(navigation, /isSearchPage/);
  assert.match(navigation, /app-topbar-context/);
  assert.match(badge, /platformLogo/);
  assert.match(badge, /platforms\/openai\.svg/);
  assert.match(badge, /platforms\/gemini\.svg/);
  assert.match(badge, /platforms\/deepseek\.svg/);
  assert.match(badge, /platforms\/qwen\.svg/);
});

test("conversation detail keeps transcript and inspector in a responsive workspace", async () => {
  const page = await source("src/app/conversations/[id]/page.tsx");

  assert.match(page, /conversation-workspace/);
  assert.match(page, /conversation-context-list/);
  assert.match(page, /conversation-transcript/);
  assert.match(page, /conversation-inspector/);
  assert.match(page, /对话信息/);
});

test("capture page presents a platform status matrix before advanced controls", async () => {
  const planner = await source("src/components/CapturePlanner.tsx");
  const guide = await source("src/components/capture/CaptureGuidePanel.tsx");

  assert.match(planner, /capture-console/);
  assert.match(guide, /platform-status-matrix/);
  assert.match(guide, /最近同步活动/);
  assert.match(guide, /首次使用设置/);
});

test("global styles include narrow-screen workspace fallbacks", async () => {
  const css = await source("src/app/globals.css");

  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /\.knowledge-workspace/);
  assert.match(css, /\.conversation-workspace/);
  assert.match(css, /\.platform-status-matrix/);
});

test("global styles keep the restrained native productivity palette", async () => {
  const css = await source("src/app/globals.css");

  assert.match(css, /--bg-page: #f5f5f7/);
  assert.match(css, /--text-primary: #1d1d1f/);
  assert.match(css, /--primary: #1769c2/);
  assert.match(css, /--divider: rgba\(0, 0, 0, 0\.07\)/);
  const panelRule = css.match(/\.panel \{([^}]*)\}/s)?.[1] ?? "";
  assert.doesNotMatch(panelRule, /box-shadow/, "panels should remain shadow-free");
  assert.doesNotMatch(css, /button, input, select, textarea \{[^}]*color:\s*inherit/s);
  assert.doesNotMatch(css, /#267457|#18583f|linear-gradient|radial-gradient/);
});
