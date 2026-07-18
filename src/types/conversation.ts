export type MessageRole = "user" | "assistant" | "system" | "unknown";

export interface Conversation {
  id: string;
  sourcePlatform: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  importedAt: string;
  tags: string[];
  manualTags: string[];
  autoTags: string[];
  summary: string | null;
  rawFileName: string | null;
  sourceUrl: string | null;
  note: string;
  insight: ConversationInsight | null;
  similarConversations: SimilarConversationReference[];
}

export interface ConversationInsight {
  summary: string;
  keyPoints: string[];
  generator: "rule" | "model";
  generatorVersion: string;
  generatedAt: string;
}

export interface SimilarConversationReference {
  conversationId: string;
  title: string;
  sourcePlatform: string;
  score: number;
  fingerprint: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string | null;
  orderIndex: number;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ParsedConversation {
  sourcePlatform: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string[];
  summary?: string | null;
  sourceUrl?: string | null;
  messages: ParsedMessage[];
}

export interface ParsedMessage {
  role: MessageRole;
  content: string;
  createdAt?: string | null;
}

export interface ImportFileInput {
  fileName: string;
  mimeType?: string;
  content: string;
}

export interface ImportResult {
  ok: boolean;
  fileName: string;
  adapter: string | null;
  importedConversations: number;
  importedMessages: number;
  updatedConversations?: number;
  skippedDuplicates?: number;
  mergeConflicts?: number;
  conversationIds: string[];
  errors: string[];
}
