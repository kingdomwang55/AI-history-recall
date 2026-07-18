import { importParsedConversations } from "@/services/import-service";
import { getSearchCorpusStats, searchConversations } from "@/services/search-service";
import { getDb } from "@/lib/db";
import type { ParsedConversation } from "@/types/conversation";

export interface SearchBenchmarkCase {
  id: string;
  query: string;
  expectedSourceUrl: string;
  intent: string;
}

export interface SearchBenchmarkCaseResult extends SearchBenchmarkCase {
  rank: number | null;
  hitTopK: boolean;
  reciprocalRank: number;
  topMatchKind: string | null;
  topScore: number | null;
  topTitle: string | null;
}

export interface SearchBenchmarkReport {
  generatedAt: string;
  topK: number;
  corpus: ReturnType<typeof getSearchCorpusStats>;
  modelCoverage: Array<{ model: string; dimensions: number; messages: number }>;
  cases: SearchBenchmarkCaseResult[];
  metrics: {
    totalCases: number;
    hitsAtK: number;
    hitRateAtK: number;
    meanReciprocalRank: number;
  };
}

export const searchBenchmarkCorpus: ParsedConversation[] = [
  {
    title: "Browser extension background capture",
    sourcePlatform: "chatgpt",
    sourceUrl: "https://chatgpt.com/c/benchmark-background-capture",
    tags: ["benchmark", "capture"],
    messages: [
      {
        role: "user",
        content: "How can the Chrome extension quietly collect new AI conversations while I stay signed in?"
      },
      {
        role: "assistant",
        content:
          "Use the browser extension to schedule low-frequency background snapshots and incremental discovery without opening extra windows."
      }
    ]
  },
  {
    title: "Semantic search with embeddings",
    sourcePlatform: "gemini",
    sourceUrl: "https://gemini.google.com/app/benchmark-semantic-search",
    tags: ["benchmark", "search"],
    messages: [
      {
        role: "user",
        content: "设计一个混合检索方案，把 SQLite 全文搜索和 embedding 向量召回结合起来。"
      },
      {
        role: "assistant",
        content:
          "先用 FTS 保证精确匹配，再用语义向量补充不同措辞的问题，合并去重后按综合分排序。"
      }
    ]
  },
  {
    title: "Official export import adapters",
    sourcePlatform: "claude",
    sourceUrl: "https://claude.ai/chat/benchmark-official-export",
    tags: ["benchmark", "import"],
    messages: [
      {
        role: "user",
        content: "Can AI History Recall import official exports from ChatGPT conversations.json, Claude, DeepSeek, and Qwen?"
      },
      {
        role: "assistant",
        content:
          "Each official JSON adapter normalizes sessions, messages, timestamps, source URLs, and platform identifiers before persistence."
      }
    ]
  },
  {
    title: "Local privacy and tokens",
    sourcePlatform: "deepseek",
    sourceUrl: "https://chat.deepseek.com/a/chat/s/benchmark-local-privacy",
    tags: ["benchmark", "privacy"],
    messages: [
      {
        role: "user",
        content: "默认情况下，对话内容、API token 和本地数据库路径应该如何保护？"
      },
      {
        role: "assistant",
        content:
          "默认只写入本机 SQLite，健康报告会脱敏 token、密钥和本地路径，外部模型必须由用户显式配置。"
      }
    ]
  },
  {
    title: "Desktop tray resource budget",
    sourcePlatform: "qwen",
    sourceUrl: "https://www.qianwen.com/chat/benchmark-desktop-idle",
    tags: ["benchmark", "desktop"],
    messages: [
      {
        role: "user",
        content: "应用关闭窗口后要像 Clash Verge 一样驻留后台，并且空闲资源占用低。"
      },
      {
        role: "assistant",
        content:
          "关闭到托盘后销毁界面，只保留轻量 daemon 和 Tauri supervisor，D5 idle 报告验证 CPU、内存和数据库唤醒预算。"
      }
    ]
  }
];

export const searchBenchmarkCases: SearchBenchmarkCase[] = [
  {
    id: "cn-semantic-search",
    query: "语义召回不同说法的问题",
    expectedSourceUrl: "https://gemini.google.com/app/benchmark-semantic-search",
    intent: "Chinese semantic retrieval should find the embedding search conversation."
  },
  {
    id: "en-extension-background",
    query: "quiet browser extension sync",
    expectedSourceUrl: "https://chatgpt.com/c/benchmark-background-capture",
    intent: "English query should find background extension capture."
  },
  {
    id: "official-json-adapters",
    query: "ChatGPT conversations.json Claude DeepSeek Qwen import",
    expectedSourceUrl: "https://claude.ai/chat/benchmark-official-export",
    intent: "Platform export query should find official adapter normalization."
  },
  {
    id: "privacy-token-redaction",
    query: "本地隐私 token 脱敏",
    expectedSourceUrl: "https://chat.deepseek.com/a/chat/s/benchmark-local-privacy",
    intent: "Privacy query should find local storage and redaction policy."
  },
  {
    id: "desktop-idle-budget",
    query: "托盘后台低资源占用",
    expectedSourceUrl: "https://www.qianwen.com/chat/benchmark-desktop-idle",
    intent: "Desktop resource query should find the tray idle budget conversation."
  }
];

export function seedSearchBenchmarkCorpus() {
  return importParsedConversations(searchBenchmarkCorpus, "search-quality-benchmark.json", "benchmark");
}

function expectedConversationId(sourceUrl: string) {
  const row = getDb()
    .prepare("SELECT id FROM conversations WHERE source_url = ? LIMIT 1")
    .get(sourceUrl) as { id: string } | undefined;
  return row?.id ?? null;
}

function modelCoverage() {
  return getDb()
    .prepare(
      `
      SELECT model, dimensions, COUNT(*) AS messages
      FROM semantic_index
      GROUP BY model, dimensions
      ORDER BY messages DESC, model ASC
    `
    )
    .all() as Array<{ model: string; dimensions: number; messages: number }>;
}

export function evaluateSearchQualityBenchmark(options: { topK?: number } = {}): SearchBenchmarkReport {
  const topK = Math.min(Math.max(Math.round(options.topK ?? 3), 1), 10);
  const cases = searchBenchmarkCases.map((item): SearchBenchmarkCaseResult => {
    const expectedId = expectedConversationId(item.expectedSourceUrl);
    const results = searchConversations({ query: item.query, sort: "newest" });
    const rankIndex = expectedId
      ? results.findIndex((result) => result.conversationId === expectedId)
      : -1;
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;
    const top = results[0] ?? null;

    return {
      ...item,
      rank,
      hitTopK: rank !== null && rank <= topK,
      reciprocalRank: rank ? 1 / rank : 0,
      topMatchKind: top?.matchKind ?? null,
      topScore: typeof top?.score === "number" ? Number(top.score.toFixed(4)) : null,
      topTitle: top?.title ?? null
    };
  });

  const hitsAtK = cases.filter((item) => item.hitTopK).length;
  const meanReciprocalRank = cases.reduce((sum, item) => sum + item.reciprocalRank, 0) / cases.length;

  return {
    generatedAt: new Date().toISOString(),
    topK,
    corpus: getSearchCorpusStats(),
    modelCoverage: modelCoverage(),
    cases,
    metrics: {
      totalCases: cases.length,
      hitsAtK,
      hitRateAtK: Number((hitsAtK / cases.length).toFixed(4)),
      meanReciprocalRank: Number(meanReciprocalRank.toFixed(4))
    }
  };
}
