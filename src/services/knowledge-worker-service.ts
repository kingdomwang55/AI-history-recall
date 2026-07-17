import { getDb, nowIso } from "@/lib/db";
import { getConversation } from "@/services/conversation-service";
import { enhanceKnowledgeWithModel } from "@/services/knowledge-model-service";
import {
  claimKnowledgeJobs,
  completeKnowledgeJob,
  failKnowledgeJob,
  getKnowledgeQueueStatus
} from "@/services/knowledge-queue-service";
import { generateRuleInsight } from "@/services/knowledge-rule-service";
import type { GeneratedInsight } from "@/services/knowledge-rule-service";
import { replaceSimilarConversations } from "@/services/similarity-service";
import type { ConversationWithMessages } from "@/types/conversation";

export interface KnowledgeBatchResult {
  claimed: number;
  completed: number;
  failed: number;
  modelDegraded: number;
  queue: ReturnType<typeof getKnowledgeQueueStatus>;
}

type EnhanceKnowledge = (
  conversation: ConversationWithMessages,
  fallback: GeneratedInsight
) => Promise<GeneratedInsight> | GeneratedInsight;

export interface ProcessKnowledgeBatchOptions {
  limit?: number;
  enhance?: EnhanceKnowledge;
}

function persistGeneratedKnowledge(
  conversationId: string,
  fingerprint: string,
  insight: GeneratedInsight
) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO conversation_insights (
        conversation_id, fingerprint, summary, key_points_json, generator,
        generator_version, generated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        summary = excluded.summary,
        key_points_json = excluded.key_points_json,
        generator = excluded.generator,
        generator_version = excluded.generator_version,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
    `
  ).run(
    conversationId,
    fingerprint,
    insight.summary,
    JSON.stringify(insight.keyPoints),
    insight.generator,
    insight.generatorVersion,
    timestamp,
    timestamp
  );

  db.prepare("DELETE FROM auto_conversation_tags WHERE conversation_id = ?").run(conversationId);
  const insertTag = db.prepare(
    `
      INSERT INTO auto_conversation_tags (
        conversation_id, tag, fingerprint, generator, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `
  );
  for (const tag of insight.tags) {
    insertTag.run(conversationId, tag, fingerprint, insight.generator, timestamp);
  }
}

export async function processKnowledgeBatch(
  options: ProcessKnowledgeBatchOptions = {}
): Promise<KnowledgeBatchResult> {
  const requestedLimit = options.limit ?? 1;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(10, Math.floor(requestedLimit)))
    : 1;
  const jobs = claimKnowledgeJobs({ limit });
  const enhance = options.enhance ?? enhanceKnowledgeWithModel;
  let completed = 0;
  let failed = 0;
  let modelDegraded = 0;

  for (const job of jobs) {
    try {
      const conversation = getConversation(job.conversationId);
      if (!conversation) throw new Error("Conversation no longer exists.");
      const ruleInsight = generateRuleInsight(conversation);
      let insight = ruleInsight;
      try {
        insight = await enhance(conversation, ruleInsight);
      } catch {
        modelDegraded += 1;
      }

      getDb().transaction(() => {
        persistGeneratedKnowledge(job.conversationId, job.fingerprint, insight);
        replaceSimilarConversations(job.conversationId, job.fingerprint);
        completeKnowledgeJob(job.id);
      }).immediate();
      completed += 1;
    } catch (error) {
      failed += 1;
      try {
        failKnowledgeJob(job.id, error);
      } catch {
        // The conversation and its queued job may have been deleted while processing.
      }
    }
  }

  return {
    claimed: jobs.length,
    completed,
    failed,
    modelDegraded,
    queue: getKnowledgeQueueStatus()
  };
}
