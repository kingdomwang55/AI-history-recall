import { getDb } from "@/lib/db";

export interface KnowledgeClusterItem {
  conversationId: string;
  title: string;
  sourcePlatform: string;
  importedAt: string;
  summary: string | null;
}

export interface KnowledgeProjectCluster {
  key: string;
  label: string;
  conversationCount: number;
  platforms: string[];
  topTags: string[];
  items: KnowledgeClusterItem[];
}

export interface KnowledgeAssetCategory {
  key: "problem" | "solution" | "code" | "decision" | "operations";
  label: string;
  description: string;
  count: number;
  items: KnowledgeClusterItem[];
}

export interface KnowledgeOrganization {
  generatedAt: string;
  totals: {
    conversations: number;
    withInsight: number;
    withAutoTags: number;
    similarityEdges: number;
  };
  projectClusters: KnowledgeProjectCluster[];
  assetCategories: KnowledgeAssetCategory[];
}

interface KnowledgeRow {
  id: string;
  title: string;
  source_platform: string;
  imported_at: string;
  summary: string | null;
  tags: string | null;
  content: string | null;
}

const assetDefinitions: Array<Omit<KnowledgeAssetCategory, "count" | "items"> & { patterns: RegExp[] }> = [
  {
    key: "problem",
    label: "问题资产",
    description: "可复用的问题描述、排查上下文和踩坑记录。",
    patterns: [/问题|排查|debug|bug|error|错误|失败|踩坑|风险/i]
  },
  {
    key: "solution",
    label: "方案资产",
    description: "已经形成结论、建议或可复用实现方案的对话。",
    patterns: [/方案|建议|结论|推荐|实现|solution|approach|design|plan/i]
  },
  {
    key: "code",
    label: "代码资产",
    description: "包含代码、接口、测试或工程实现细节的对话。",
    patterns: [/代码|实现|接口|测试|typescript|javascript|python|api|sqlite|tauri|next\.js|```/i]
  },
  {
    key: "decision",
    label: "决策资产",
    description: "涉及取舍、评估、优先级和产品判断的对话。",
    patterns: [/决策|取舍|评估|优先级|roadmap|tradeoff|选择|是否|为什么/i]
  },
  {
    key: "operations",
    label: "运维资产",
    description: "安装、发布、配置、健康检查和桌面化运行经验。",
    patterns: [/安装|发布|配置|健康|诊断|后台|托盘|签名|公证|更新|deploy|release|desktop/i]
  }
];

const projectSeedTags = [
  "AI History Recall",
  "语义搜索",
  "浏览器扩展",
  "数据采集",
  "桌面应用",
  "知识管理",
  "SQLite",
  "Embedding",
  "自动摘要",
  "自动标签",
  "测试",
  "API",
  "ChatGPT",
  "Gemini",
  "DeepSeek",
  "通义千问",
  "Claude"
];

function splitTags(value: string | null) {
  return (value ?? "")
    .split("\u001f")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function itemFromRow(row: KnowledgeRow): KnowledgeClusterItem {
  return {
    conversationId: row.id,
    title: row.title,
    sourcePlatform: row.source_platform,
    importedAt: row.imported_at,
    summary: row.summary
  };
}

function labelForRow(row: KnowledgeRow, tags: string[]) {
  const haystack = `${row.title}\n${row.summary ?? ""}\n${row.content ?? ""}`;
  const direct = projectSeedTags.find((tag) =>
    tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase()) || haystack.includes(tag)
  );
  if (direct) return direct;
  return tags[0] ?? row.source_platform;
}

function topTags(rows: Array<{ tags: string[] }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, 5)
    .map(([tag]) => tag);
}

function rowsForOrganization() {
  return getDb()
    .prepare(
      `
      SELECT
        c.id,
        c.title,
        c.source_platform,
        c.imported_at,
        COALESCE(c.summary, ci.summary) AS summary,
        GROUP_CONCAT(DISTINCT tag_value) AS tags,
        (
          SELECT GROUP_CONCAT(m.content, char(10))
          FROM messages m
          WHERE m.conversation_id = c.id
        ) AS content
      FROM conversations c
      LEFT JOIN conversation_insights ci ON ci.conversation_id = c.id
      LEFT JOIN (
        SELECT ct.conversation_id, t.name AS tag_value
        FROM conversation_tags ct
        JOIN tags t ON t.id = ct.tag_id
        UNION ALL
        SELECT conversation_id, tag AS tag_value
        FROM auto_conversation_tags
      ) tag_union ON tag_union.conversation_id = c.id
      GROUP BY c.id
      ORDER BY datetime(c.imported_at) DESC
    `
    )
    .all() as KnowledgeRow[];
}

export function getKnowledgeOrganization(): KnowledgeOrganization {
  const db = getDb();
  const rows = rowsForOrganization().map((row) => ({ row, tags: splitTags(row.tags) }));
  const totals = {
    conversations: (db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count,
    withInsight: (db.prepare("SELECT COUNT(*) AS count FROM conversation_insights").get() as { count: number }).count,
    withAutoTags: (
      db.prepare("SELECT COUNT(DISTINCT conversation_id) AS count FROM auto_conversation_tags").get() as { count: number }
    ).count,
    similarityEdges: (db.prepare("SELECT COUNT(*) AS count FROM conversation_similarities").get() as { count: number }).count
  };

  const clusters = new Map<string, Array<{ row: KnowledgeRow; tags: string[] }>>();
  for (const item of rows) {
    const label = labelForRow(item.row, item.tags);
    const key = label.toLocaleLowerCase();
    const group = clusters.get(key) ?? [];
    group.push(item);
    clusters.set(key, group);
  }

  const projectClusters = [...clusters.entries()]
    .map(([key, group]) => ({
      key,
      label: group[0] ? labelForRow(group[0].row, group[0].tags) : key,
      conversationCount: group.length,
      platforms: [...new Set(group.map((item) => item.row.source_platform))].sort(),
      topTags: topTags(group),
      items: group.slice(0, 6).map((item) => itemFromRow(item.row))
    }))
    .sort((left, right) => right.conversationCount - left.conversationCount || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, 12);

  const assetCategories = assetDefinitions.map((definition) => {
    const matches = rows.filter(({ row, tags }) => {
      const haystack = `${row.title}\n${row.summary ?? ""}\n${tags.join(" ")}\n${row.content ?? ""}`;
      return definition.patterns.some((pattern) => pattern.test(haystack));
    });
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      count: matches.length,
      items: matches.slice(0, 6).map((item) => itemFromRow(item.row))
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totals,
    projectClusters,
    assetCategories
  };
}
