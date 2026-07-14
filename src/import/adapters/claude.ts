import type { ConversationAdapter } from "./base";

export const claudeAdapter: ConversationAdapter = {
  id: "claude",
  displayName: "Claude Adapter",
  canHandle() {
    return false;
  },
  async parse() {
    throw new Error("Claude official export adapter is planned for a later version.");
  }
};
