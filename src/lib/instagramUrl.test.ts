import { describe, expect, it } from "vitest";
import { getInstagramSourceKind, validateInstagramUrl } from "./instagramUrl";

describe("validateInstagramUrl", () => {
  it("accepts Instagram post URLs", () => {
    expect(validateInstagramUrl("https://www.instagram.com/p/abc123/").ok).toBe(true);
  });

  it("normalizes shared Instagram URLs by removing tracking query params", () => {
    expect(validateInstagramUrl("https://www.instagram.com/p/DZ-boFRkeAm/?igsh=MWRjNWg1MGkxMGppMA==")).toEqual({
      ok: true,
      url: "https://www.instagram.com/p/DZ-boFRkeAm/"
    });
  });

  it("accepts Instagram reel URLs", () => {
    expect(validateInstagramUrl("https://www.instagram.com/reel/abc123/").ok).toBe(true);
  });

  it("rejects an empty URL with a clear message", () => {
    expect(validateInstagramUrl("")).toEqual({
      ok: false,
      message: "Paste an Instagram post or reel URL."
    });
  });

  it("rejects non-Instagram URLs", () => {
    expect(validateInstagramUrl("https://example.com/p/abc123/").ok).toBe(false);
  });

  it("detects post and reel URL kinds", () => {
    expect(getInstagramSourceKind("https://www.instagram.com/p/abc123/")).toBe("post");
    expect(getInstagramSourceKind("https://www.instagram.com/reel/abc123/")).toBe("reel");
    expect(getInstagramSourceKind("https://www.instagram.com/tv/abc123/")).toBe("reel");
  });
});
