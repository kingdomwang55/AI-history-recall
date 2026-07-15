import { capturePlatformConfigs } from "@/capture/platforms";
import type { CapturePlatform } from "@/capture/types";

export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;

export function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

export function parseLoopbackHttpUrl(value: string, label = "URL") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 必须是有效 URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} 只允许 http/https`);
  }

  if (!isLoopbackHost(url.hostname)) {
    throw new Error(`${label} 只允许 127.0.0.1、localhost 或 ::1`);
  }

  return url;
}

export function isTrustedLocalRequest(request: Request) {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  if (!isLoopbackHost(requestUrl.hostname)) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      return isLoopbackHost(originUrl.hostname);
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  }

  return true;
}

export function requireJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  return null;
}

export function requireBodySizeLimit(request: Request, maxBytes: number) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return null;
  }

  const length = Number(rawLength);
  if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
    return Response.json(
      { error: `请求体过大，最大 ${Math.floor(maxBytes / 1024 / 1024)} MB` },
      { status: 413 }
    );
  }

  return null;
}

export async function readJsonBody<T = unknown>(request: Request, maxBytes = MAX_JSON_BODY_BYTES) {
  const contentTypeError = requireJsonRequest(request);
  if (contentTypeError) {
    return { data: null as T | null, error: contentTypeError };
  }

  const sizeError = requireBodySizeLimit(request, maxBytes);
  if (sizeError) {
    return { data: null as T | null, error: sizeError };
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      data: null as T | null,
      error: Response.json(
        { error: `请求体过大，最大 ${Math.floor(maxBytes / 1024)} KB` },
        { status: 413 }
      )
    };
  }

  try {
    return { data: JSON.parse(text) as T, error: null };
  } catch {
    return { data: null as T | null, error: Response.json({ error: "JSON 格式无效" }, { status: 400 }) };
  }
}

export function isAllowedPlatformUrl(platform: CapturePlatform, rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  const config = capturePlatformConfigs[platform];
  return config.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function parseCdpPort(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error("Chrome CDP 端口必须是 1024-65535 之间的整数");
  }

  return value;
}
