import type { ConversationWithMessages } from "@/types/conversation";

export interface GeneratedInsight {
  summary: string;
  keyPoints: string[];
  tags: string[];
  generator: "rule" | "model";
  generatorVersion: string;
}

export const RULE_GENERATOR_VERSION = "rule-v1";

const conclusionPattern =
  /总结|结论|最终|因此|所以|建议|推荐|方案|可以|应该|in summary|in conclusion|therefore|recommend|solution|result/i;

const domainTags: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "语义搜索", pattern: /语义搜索|semantic search|semantic retrieval/i },
  { tag: "混合检索", pattern: /混合检索|hybrid search|hybrid retrieval/i },
  { tag: "SQLite", pattern: /sqlite|fts5?|全文检索/i },
  { tag: "Embedding", pattern: /\bembedding(s)?\b|向量嵌入/i },
  { tag: "向量检索", pattern: /向量检索|vector search|vector recall/i },
  { tag: "自动摘要", pattern: /自动摘要|摘要生成|summari[sz]/i },
  { tag: "自动标签", pattern: /自动标签|标签生成|auto.?tag/i },
  { tag: "知识管理", pattern: /知识管理|knowledge management|knowledge base/i },
  { tag: "数据采集", pattern: /数据采集|历史采集|capture|collector/i },
  { tag: "浏览器扩展", pattern: /浏览器扩展|browser extension|chrome extension/i },
  { tag: "桌面应用", pattern: /桌面应用|desktop app|tauri|electron/i },
  { tag: "TypeScript", pattern: /typescript|```ts\b|```tsx\b/i },
  { tag: "JavaScript", pattern: /javascript|```js\b|```jsx\b/i },
  { tag: "Python", pattern: /python|```py\b/i },
  { tag: "API", pattern: /\bapi\b|接口/i },
  { tag: "测试", pattern: /单元测试|回归测试|\btests?\b|tdd/i }
];

const platformTags: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  tongyi: "通义千问",
  claude: "Claude"
};

function redactSecrets(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [已隐藏]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[已隐藏]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|token|secret|password)\s*[:=]\s*["']?[^\s,;"']+/gi,
      "$1=[已隐藏]"
    );
}

function cleanText(value: string) {
  return redactSecrets(value)
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function paragraphs(value: string) {
  return redactSecrets(value)
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .replace(/```/g, "")
    .split(/\n+|(?<=[。！？.!?])\s*/)
    .map(cleanText)
    .filter((part) => part.length >= 8);
}

function informationScore(value: string, position: number, total: number) {
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  const uniqueTerms = new Set(terms).size;
  const markerScore = conclusionPattern.test(value) ? 8 : 0;
  const lengthScore = Math.min(6, Math.floor(value.length / 32));
  const densityScore = Math.min(5, Math.floor(uniqueTerms / 5));
  const recencyScore = total > 1 ? (position / (total - 1)) * 2 : 1;
  return markerScore + lengthScore + densityScore + recencyScore;
}

function uniqueByNormalized(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repeatedTechnicalPhrases(value: string) {
  const words = value.toLocaleLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (let index = 0; index < words.length - 1; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]}`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phrase]) => phrase)
    .filter((phrase) => !/^(this|that|with|from|have|will|your|then)\b/.test(phrase))
    .slice(0, 2);
}

export function generateRuleInsight(conversation: ConversationWithMessages): GeneratedInsight {
  const orderedMessages = [...conversation.messages].sort((left, right) => left.orderIndex - right.orderIndex);
  const problemMessage =
    orderedMessages.find((message) => message.role === "user" && cleanText(message.content).length >= 8) ??
    orderedMessages.find((message) => cleanText(message.content).length >= 8);
  const problem = cleanText(problemMessage?.content ?? conversation.title);

  const assistantParagraphs = orderedMessages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => paragraphs(message.content));
  const ranked = assistantParagraphs
    .map((value, index) => ({ value, score: informationScore(value, index, assistantParagraphs.length), index }))
    .sort((left, right) => right.score - left.score || right.index - left.index);
  const conclusion = ranked[0]?.value ?? "";

  const summary = truncate(
    conclusion
      ? `问题：${truncate(problem, 96)} 结论：${truncate(conclusion, 108)}`
      : `问题：${truncate(problem, 210)}`,
    220
  );
  const keyPoints = uniqueByNormalized(ranked.map((item) => truncate(item.value, 120))).slice(0, 5);

  const searchableText = cleanText(
    `${conversation.title}\n${orderedMessages.map((message) => message.content).join("\n")}`
  );
  const controlled = domainTags.filter((entry) => entry.pattern.test(searchableText)).map((entry) => entry.tag);
  const repeated = repeatedTechnicalPhrases(searchableText).map((phrase) => truncate(phrase, 32));
  const platform = platformTags[conversation.sourcePlatform.toLocaleLowerCase()];
  const tags = uniqueByNormalized([...controlled, ...repeated, ...(platform ? [platform] : [])])
    .filter((tag) => tag.length <= 32)
    .slice(0, 8);

  return {
    summary,
    keyPoints,
    tags,
    generator: "rule",
    generatorVersion: RULE_GENERATOR_VERSION
  };
}
