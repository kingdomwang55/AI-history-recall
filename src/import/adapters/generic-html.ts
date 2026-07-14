import type { ConversationAdapter } from "./base";
import { cleanTitle, extensionOf, fileBaseName } from "./base";
import { parseRoleBlocks } from "./role-parser";

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }

    return entities[key] ?? match;
  });
}

function htmlTitle(content: string) {
  const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return stripHtml(title ?? h1 ?? "").trim();
}

function stripHtml(content: string) {
  return decodeEntities(
    content
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<(br|p|div|li|h[1-6]|section|article|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
  ).trim();
}

export const genericHtmlAdapter: ConversationAdapter = {
  id: "generic_html",
  displayName: "Generic HTML Adapter",
  canHandle(input) {
    const extension = extensionOf(input.fileName);
    return extension === "html" || extension === "htm" || input.mimeType === "text/html";
  },
  async parse(input) {
    const text = stripHtml(input.content);

    return [
      {
        sourcePlatform: "generic_html",
        title: cleanTitle(htmlTitle(input.content), fileBaseName(input.fileName)),
        messages: parseRoleBlocks(text)
      }
    ];
  }
};
