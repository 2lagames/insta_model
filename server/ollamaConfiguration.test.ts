import { describe, expect, it } from "vitest";
import { getActiveOllamaConfiguration } from "./ollamaConfiguration";

describe("getActiveOllamaConfiguration", () => {
  it("rejects an explicitly empty saved prompt instruction", () => {
    expect(() => getActiveOllamaConfiguration({
      ollamaProvider: "local",
      ollamaLocalModel: "llama3.2-vision",
      ollamaPromptInstruction: ""
    })).toThrow("Add a prompt instruction");
  });
});
