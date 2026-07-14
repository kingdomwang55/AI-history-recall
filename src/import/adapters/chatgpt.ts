import type { ConversationAdapter } from "./base";

export const chatGptAdapter: ConversationAdapter = {
  id: "chatgpt",
  displayName: "ChatGPT Adapter",
  canHandle() {
    return false;
  },
  async parse() {
    throw new Error("ChatGPT official export adapter is planned for a later version.");
  }
};
