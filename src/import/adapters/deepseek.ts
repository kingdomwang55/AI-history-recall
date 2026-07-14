import type { ConversationAdapter } from "./base";

export const deepSeekAdapter: ConversationAdapter = {
  id: "deepseek",
  displayName: "DeepSeek Adapter",
  canHandle() {
    return false;
  },
  async parse() {
    throw new Error("DeepSeek history adapter is planned for a later version.");
  }
};
