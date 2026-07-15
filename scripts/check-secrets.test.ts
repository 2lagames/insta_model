import { describe, expect, it } from "vitest";
import { scanSecretText } from "./check-secrets";

describe("scanSecretText", () => {
  it("rejects a real-looking credential signature", () => {
    const secret = "sk-" + "live_1234567890abcdefghijklmnop";
    const findings = scanSecretText("src/config.ts", `const apiKey = "${secret}";`);

    expect(findings).toContain("src/config.ts: possible OpenAI-style API key");
  });

  it("rejects an exact locally saved API key even when its format is provider-specific", () => {
    const localSecret = "provider-specific-value-987654321";

    expect(scanSecretText("src/config.ts", `export const value = "${localSecret}";`, [localSecret])).toContain(
      "src/config.ts: contains a locally saved API key"
    );
  });

  it.each([
    "data/connections.local.json",
    "input/source.png",
    "output/result.png",
    ".env.production",
    "private/credentials.json"
  ])("rejects a private runtime path: %s", (path) => {
    expect(scanSecretText(path, "ordinary content")).toContain(`${path}: private runtime path must not be committed`);
  });

  it("allows ordinary source and documented fake test credentials", () => {
    expect(scanSecretText("src/config.ts", 'const endpoint = "http://127.0.0.1";')).toEqual([]);
    expect(scanSecretText("server/example.test.ts", 'const apiKey = "fake_example_key_1234567890";')).toEqual([]);
  });
});
