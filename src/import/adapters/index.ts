import type { ConversationAdapter } from "./base";
import { chatGptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { deepSeekAdapter } from "./deepseek";
import { genericHtmlAdapter } from "./generic-html";
import { genericJsonAdapter } from "./generic-json";
import { genericMarkdownAdapter } from "./generic-markdown";
import { genericTextAdapter } from "./generic-text";
import { qwenAdapter } from "./qwen";

export const adapters: ConversationAdapter[] = [
  chatGptAdapter,
  claudeAdapter,
  deepSeekAdapter,
  qwenAdapter,
  genericJsonAdapter,
  genericMarkdownAdapter,
  genericHtmlAdapter,
  genericTextAdapter
];

export function findAdapter(input: Parameters<ConversationAdapter["canHandle"]>[0]) {
  return adapters.find((adapter) => adapter.canHandle(input));
}
