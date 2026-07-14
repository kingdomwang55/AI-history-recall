export type ApiState = "idle" | "planning" | "capturing" | "runningAll" | "agent" | "chrome" | "extension";

export type Platform = "chatgpt" | "gemini" | "deepseek" | "qwen";

export type JobSummary = {
  id: string;
  instruction: string;
  status: string;
  updatedAt: string;
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  totalTargets: number;
};

export type ChromeStatus = {
  ok: boolean;
  endpoint: string;
  browser: string | null;
  error: string | null;
};

export type PlatformPreflight = {
  platform: Platform;
  open: boolean;
  title: string | null;
  url: string | null;
  likelyLoggedIn: boolean | null;
  hint: string;
};

export type PlatformAudit = {
  platform: Platform;
  importedConversations: number;
  importedMessages: number;
  indexedMessages: number;
  latestImportedAt: string | null;
  latestDiscovery: {
    createdAt: string;
    targetsFound: number;
    failuresCount: number;
    scannedTitlesCount: number;
    stopReason: string | null;
    scrollsPerformed: number | null;
    exhaustive: boolean;
    exhausted: boolean;
    evidenceStrong: boolean;
  } | null;
  status: string;
  hint: string;
  targetCounts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
};

export type CaptureAuditSummary = {
  locallyConsistent: boolean;
  readyForReview: boolean;
  nextAction: string;
  completionNote: string;
  totals: {
    importedConversations: number;
    importedMessages: number;
    indexedMessages: number;
    pendingTargets: number;
    failedTargets: number;
  };
};

export type ExtensionRunStatus = {
  status?: string;
  phase?: string;
  extensionVersion?: string;
  extensionBuildId?: string;
  platform?: string;
  platforms?: Platform[];
  totalTargets?: number;
  processed?: number;
  nextIndex?: number;
  processing?: boolean;
  queue?: unknown[];
  queuePlatformCounts?: Partial<Record<Platform | "unknown", number>>;
  currentTarget?: {
    platform?: Platform;
    title?: string;
    url?: string;
    index?: number;
    total?: number;
  } | null;
  importedConversations?: number;
  importedMessages?: number;
  skippedDuplicates?: number;
  discoveryProgress?: {
    platform?: Platform;
    phase?: string;
    scrollIndex?: number;
    maxScrolls?: number;
    currentTitle?: string;
    platformIndex?: number;
    totalPlatforms?: number;
    targetsFound?: number;
    scannedTitles?: number;
    failures?: number;
    scrollBefore?: number;
    scrollAfter?: number;
    scrollTarget?: number;
    scrollMoved?: boolean;
    scrollAtEnd?: boolean;
    stopReason?: string;
    error?: string;
    updatedAt?: string;
  };
  failures?: Array<{ platform?: string; url?: string; title?: string; error: string }>;
  discoveries?: Array<{ platform: Platform; targets?: unknown[]; stopReason?: string }>;
  error?: string;
};
