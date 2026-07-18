import Link from "next/link";
import { Boxes, BrainCircuit, FolderKanban, Network, Tags } from "lucide-react";
import { PlatformBadge } from "@/components/PlatformBadge";
import { formatDateTime } from "@/lib/format";
import { getKnowledgeOrganization } from "@/services/knowledge-organization-service";

export const dynamic = "force-dynamic";

function ConversationMiniList({
  items
}: {
  items: Array<{
    conversationId: string;
    title: string;
    sourcePlatform: string;
    importedAt: string;
    summary: string | null;
  }>;
}) {
  if (!items.length) return <p className="knowledge-empty-line">暂无匹配对话</p>;
  return (
    <div className="knowledge-mini-list">
      {items.map((item) => (
        <Link key={item.conversationId} href={`/conversations/${item.conversationId}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><PlatformBadge platform={item.sourcePlatform} /><span>{formatDateTime(item.importedAt)}</span></div>
            <strong>{item.title}</strong>
            {item.summary ? <p>{item.summary}</p> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function KnowledgePage() {
  const organization = getKnowledgeOrganization();

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">知识组织</h1>
          <p className="page-description">把自动摘要、标签和相似对话聚合成项目线索与问题资产。</p>
        </div>
      </header>

      <section className="knowledge-overview-grid" aria-label="知识处理概览">
        <div><BrainCircuit size={17} /><strong>{organization.totals.conversations}</strong><span>总对话</span></div>
        <div><Tags size={17} /><strong>{organization.totals.withAutoTags}</strong><span>已自动标签</span></div>
        <div><Boxes size={17} /><strong>{organization.totals.withInsight}</strong><span>已提炼摘要</span></div>
        <div><Network size={17} /><strong>{organization.totals.similarityEdges}</strong><span>相似关联</span></div>
      </section>

      <section className="knowledge-organization-layout">
        <div className="knowledge-organization-main">
          <div className="section-heading-row"><div><h2>项目聚类</h2><p>按主题标签、平台和语义线索自动归组。</p></div><FolderKanban size={18} /></div>
          <div className="project-cluster-grid">
            {organization.projectClusters.length ? organization.projectClusters.map((cluster) => (
              <article className="project-cluster-panel" key={cluster.key}>
                <div className="project-cluster-head">
                  <div><h3>{cluster.label}</h3><p>{cluster.conversationCount} 条对话 · {cluster.platforms.join(" / ")}</p></div>
                </div>
                {cluster.topTags.length ? <div className="knowledge-tag-row">{cluster.topTags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                <ConversationMiniList items={cluster.items} />
              </article>
            )) : <div className="knowledge-empty-state">暂无聚类数据。导入或采集对话后，后台知识处理会自动生成组织视图。</div>}
          </div>
        </div>

        <aside className="knowledge-asset-sidebar">
          <div className="section-heading-row"><div><h2>问题资产分类</h2><p>按可复用资产类型整理。</p></div></div>
          <div className="asset-category-list">
            {organization.assetCategories.map((category) => (
              <section className="asset-category-panel" key={category.key}>
                <div className="asset-category-head"><h3>{category.label}</h3><strong>{category.count}</strong></div>
                <p>{category.description}</p>
                <ConversationMiniList items={category.items.slice(0, 3)} />
              </section>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
