import { describe, expect, it } from "vitest";
import { parseGenerationConcurrency } from "./generationConcurrency";

describe("parseGenerationConcurrency", () => {
  it("defaults to two global slots", () => {
    expect(parseGenerationConcurrency(undefined)).toBe(2);
  });

  it.each(["0", "3", "two", "1.5"])("rejects unsupported value %s", (value) => {
    expect(() => parseGenerationConcurrency(value)).toThrow("GENERATION_CONCURRENCY");
  });

  it("allows one diagnostic slot", () => {
    expect(parseGenerationConcurrency("1")).toBe(1);
  });
});
