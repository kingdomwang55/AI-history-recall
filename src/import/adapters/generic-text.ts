import type { ConversationAdapter } from "./base";
import { cleanTitle, extensionOf, fileBaseName } from "./base";
import { parseRoleBlocks } from "./role-parser";

const inlineRoleStartPattern =
  /^\s*(user|assistant|system|human|ai|bot|用户|助手|系统|问题|回答|问|答|q|a)\s*[:：]/i;

function splitTitleAndBody(content: string, fallbackTitle: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return {
      title: fallbackTitle,
      body: content
    };
  }

  const title = lines[firstContentIndex].trim();
  if (inlineRoleStartPattern.test(title)) {
    return {
      title: fallbackTitle,
      body: content
    };
  }

  const body = [
    ...lines.slice(0, firstContentIndex),
    ...lines.slice(firstContentIndex + 1)
  ].join("\n");

  return { title, body };
}

export const genericTextAdapter: ConversationAdapter = {
  id: "generic_text",
  displayName: "Generic TXT Adapter",
  canHandle(input) {
    const extension = extensionOf(input.fileName);
    return extension === "txt" || input.mimeType?.startsWith("text/plain") === true;
  },
  async parse(input) {
    const fallbackTitle = fileBaseName(input.fileName);
    const { title, body } = splitTitleAndBody(input.content, fallbackTitle);

    return [
      {
        sourcePlatform: "generic_text",
        title: cleanTitle(title, fallbackTitle),
        messages: parseRoleBlocks(body)
      }
    ];
  }
};
