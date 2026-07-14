import type { ParsedConversation, ParsedMessage } from "@/types/conversation";

export type CapturePlatform = "chatgpt" | "gemini" | "deepseek" | "qwen";

export interface CaptureRateLimit {
  pageDelayMs: number;
  pageJitterMs: number;
  afterScrollDelayMs: number;
}

export interface CaptureScrollStep {
  x: number;
  y: number;
  scrollY: number;
  scrollX?: number;
  delayMs?: number;
}

export interface CapturePlatformConfig {
  id: CapturePlatform;
  label: string;
  hosts: string[];
  historyUrl: string;
  defaultTags: string[];
  rateLimit: CaptureRateLimit;
  hydrateScrolls: CaptureScrollStep[];
  extractor: string;
  historyExtractor?: string;
}

export interface CaptureTarget {
  platform: CapturePlatform;
  url: string;
  title?: string;
}

export interface CapturePlan {
  targets: CaptureTarget[];
  rateLimit?: Partial<CaptureRateLimit>;
  importAfterCapture?: boolean;
}

export interface CaptureDiscoveryOptions {
  platform: CapturePlatform;
  maxItems?: number;
  maxScrolls?: number;
  stopAfterNoNewScrolls?: number;
  exhaustive?: boolean;
  startUrl?: string;
  rateLimit?: Partial<CaptureRateLimit>;
}

export interface CaptureDiscoveryResult {
  targets: CaptureTarget[];
  failures: Array<{
    platform: CapturePlatform;
    title?: string;
    error: string;
  }>;
  scannedTitles: string[];
  stopReason?: "max_items" | "max_scrolls" | "no_new_targets";
  scrollsPerformed?: number;
  maxItemsReached?: boolean;
  maxScrollsReached?: boolean;
  exhaustive?: boolean;
}

export interface CapturedConversation extends ParsedConversation {
  sourcePlatform: CapturePlatform;
  sourceUrl: string;
}

export interface BrowserCaptureResult {
  conversations: CapturedConversation[];
  failures: Array<{
    platform: CapturePlatform;
    url: string;
    title?: string;
    error: string;
  }>;
}

export interface ExtractedMessage extends ParsedMessage {
  orderIndex?: number;
}
