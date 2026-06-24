import { describe, expect, it } from "vitest";
import { validateInstagramUrl } from "./instagramUrl";

describe("validateInstagramUrl", () => {
  it("accepts Instagram post URLs", () => {
    expect(validateInstagramUrl("https://www.instagram.com/p/abc123/").ok).toBe(true);
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
});
