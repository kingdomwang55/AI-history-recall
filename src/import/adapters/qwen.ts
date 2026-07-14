import type { ConversationAdapter } from "./base";

export const qwenAdapter: ConversationAdapter = {
  id: "qwen",
  displayName: "通义千问 Adapter",
  canHandle() {
    return false;
  },
  async parse() {
    throw new Error("通义千问官方导出 adapter is planned for a later version.");
  }
};
