import { requireApiToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type CaptureTarget = {
  platform?: unknown;
  url?: unknown;
  title?: unknown;
};

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const platform = new URL(request.url).searchParams.get("platform");
  if (!platform || !["chatgpt", "gemini", "deepseek", "qwen"].includes(platform)) {
    return Response.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const rows = getDb()
    .prepare(
      `
      SELECT title, MIN(source_url) AS url
      FROM conversations
      WHERE source_platform = ? AND source_url IS NOT NULL AND title IS NOT NULL
      GROUP BY title
      HAVING COUNT(*) = 1
    `
    )
    .all(platform) as Array<{ title: string; url: string }>;
  const knownTargetsByTitle = Object.fromEntries(
    rows.filter((row) => row.title && row.url).map((row) => [row.title.trim(), { url: row.url }])
  );

  return Response.json({ knownTargetsByTitle });
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const rawTargets =
    typeof body === "object" && body !== null && Array.isArray((body as { targets?: unknown }).targets)
      ? ((body as { targets: CaptureTarget[] }).targets ?? [])
      : [];

  const targets = rawTargets
    .filter((target) => typeof target?.url === "string" && target.url.length > 0)
    .slice(0, 3000);
  if (targets.length === 0) return Response.json({ targets: [], skipped: 0 });

  const urls = [...new Set(targets.map((target) => target.url as string))];
  const placeholders = urls.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT source_url FROM conversations WHERE source_url IN (${placeholders})`)
    .all(...urls) as Array<{ source_url: string }>;
  const known = new Set(rows.map((row) => row.source_url));
  const updateTitle = getDb().prepare(
    `
    UPDATE conversations
    SET title = ?
    WHERE source_platform = ? AND source_url = ?
      AND (title = '千问-阿里 AI 助手' OR title = source_url)
  `
  );
  getDb().transaction(() => {
    for (const target of targets) {
      if (!known.has(target.url as string)) continue;
      if (typeof target.title !== "string" || !target.title.trim()) continue;
      updateTitle.run(target.title.trim(), target.platform, target.url);
    }
  })();
  const unknown = targets.filter((target) => !known.has(target.url as string));

  return Response.json({ targets: unknown, skipped: targets.length - unknown.length });
}
