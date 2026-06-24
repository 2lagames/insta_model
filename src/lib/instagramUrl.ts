import type { UrlValidationResult } from "./importTypes";

const supportedPathPattern = /^\/(p|reel|tv)\/[^/]+\/?$/;

export function validateInstagramUrl(value: string): UrlValidationResult {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: false, message: "Paste an Instagram post or reel URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "Enter a valid Instagram URL." };
  }

  const host = parsed.hostname.toLowerCase();
  const isInstagramHost = host === "instagram.com" || host === "www.instagram.com";
  if (!isInstagramHost) {
    return { ok: false, message: "Only Instagram post and reel URLs are supported." };
  }

  if (!supportedPathPattern.test(parsed.pathname)) {
    return { ok: false, message: "Use an Instagram /p/, /reel/, or /tv/ URL." };
  }

  return { ok: true, url: parsed.toString() };
}
