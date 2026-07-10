import type { InstagramSourceKind, UrlValidationResult } from "./importTypes";

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

  return { ok: true, url: toCanonicalInstagramUrl(parsed) };
}

export function getInstagramSourceKind(value: string): InstagramSourceKind {
  const pathname = new URL(value).pathname;
  return pathname.startsWith("/reel/") || pathname.startsWith("/tv/") ? "reel" : "post";
}

export function canonicalizeInstagramUrl(value: string): string {
  return toCanonicalInstagramUrl(new URL(value));
}

function toCanonicalInstagramUrl(parsed: URL): string {
  const [, kind, shortcode] = parsed.pathname.match(/^\/(p|reel|tv)\/([^/]+)\/?$/) ?? [];
  return `https://www.instagram.com/${kind}/${shortcode}/`;
}
