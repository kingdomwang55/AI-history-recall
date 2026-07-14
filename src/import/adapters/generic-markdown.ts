import type { ConversationAdapter } from "./base";
import { cleanTitle, extensionOf, fileBaseName } from "./base";
import { parseRoleBlocks } from "./role-parser";

function markdownTitle(content: string) {
  const titleMatch = content.match(/^\s{0,3}#\s+(.+)$/m);
  return titleMatch?.[1]?.trim();
}

function removeFirstH1(content: string) {
  return content.replace(/^\s{0,3}#\s+.+\n?/m, "").trim();
}

function removeFrontmatter(content: string) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export const genericMarkdownAdapter: ConversationAdapter = {
  id: "generic_markdown",
  displayName: "Generic Markdown Adapter",
  canHandle(input) {
    const extension = extensionOf(input.fileName);
    return (
      extension === "md" ||
      extension === "markdown" ||
      input.mimeType === "text/markdown"
    );
  },
  async parse(input) {
    const content = removeFrontmatter(input.content);
    const title = markdownTitle(content);
    const body = title ? removeFirstH1(content) : content;

    return [
      {
        sourcePlatform: "generic_markdown",
        title: cleanTitle(title, fileBaseName(input.fileName)),
        messages: parseRoleBlocks(body)
      }
    ];
  }
};
