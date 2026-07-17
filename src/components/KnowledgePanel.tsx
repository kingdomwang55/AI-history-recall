import Link from "next/link";
import { ArrowUpRight, ListChecks, Network, Sparkles, Tags } from "lucide-react";
import { PlatformBadge } from "@/components/PlatformBadge";
import type { ConversationInsight, SimilarConversationReference } from "@/types/conversation";

export function KnowledgePanel({
  explicitSummary,
  insight,
  autoTags,
  similarConversations
}: {
  explicitSummary: string | null;
  insight: ConversationInsight | null;
  autoTags: string[];
  similarConversations: SimilarConversationReference[];
}) {
  const summary = explicitSummary || insight?.summary || null;
  const hasKnowledge = Boolean(summary || insight?.keyPoints.length || autoTags.length || similarConversations.length);

  if (!hasKnowledge) {
    return (
      <section className="knowledge-panel knowledge-panel-empty">
        <Sparkles size={17} aria-hidden="true" />
        <div><h2>知识提炼</h2><p>等待后台处理</p></div>
      </section>
    );
  }

  return (
    <section className="knowledge-panel">
      {summary ? (
        <div className="knowledge-summary">
          <div className="knowledge-section-title"><Sparkles size={15} /><h2>{explicitSummary ? "原始摘要" : "自动摘要"}</h2>{!explicitSummary && insight ? <span>{insight.generator === "model" ? "模型增强" : "本地规则"}</span> : null}</div>
          <p>{summary}</p>
        </div>
      ) : null}

      {explicitSummary && insight?.summary && insight.summary !== explicitSummary ? (
        <div className="knowledge-subsection knowledge-generated-summary">
          <div className="knowledge-section-title"><Sparkles size={15} /><h2>自动摘要</h2><span>{insight.generator === "model" ? "模型增强" : "本地规则"}</span></div>
          <p>{insight.summary}</p>
        </div>
      ) : null}

      {insight?.keyPoints.length ? (
        <div className="knowledge-subsection">
          <div className="knowledge-section-title"><ListChecks size={15} /><h2>关键要点</h2></div>
          <ul>{insight.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      ) : null}

      {autoTags.length ? (
        <div className="knowledge-subsection">
          <div className="knowledge-section-title"><Tags size={15} /><h2>自动标签</h2></div>
          <div className="knowledge-auto-tags">{autoTags.map((tag) => <span key={tag}><Sparkles size={10} />{tag}</span>)}</div>
        </div>
      ) : null}

      {similarConversations.length ? (
        <div className="knowledge-subsection">
          <div className="knowledge-section-title"><Network size={15} /><h2>相似对话</h2></div>
          <div className="knowledge-similar-list">
            {similarConversations.map((item) => (
              <Link key={item.conversationId} href={`/conversations/${item.conversationId}`}>
                <PlatformBadge platform={item.sourcePlatform} />
                <span>{item.title}</span>
                <small>{Math.round(item.score * 100)}%</small>
                <ArrowUpRight size={13} />
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
