import { describe, expect, it, vi } from "vitest";
import { generateOllamaPrompt, listOllamaModels } from "./ollamaClient";

describe("listOllamaModels", () => {
  it("uses bearer authentication and the tags endpoint for Cloud", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: "gemma3" }]
    })));

    await expect(listOllamaModels({
      provider: "cloud",
      apiKey: "cloud-key",
      fetchImpl
    })).resolves.toEqual([{ name: "gemma3" }]);

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/tags", "https://ollama.com"), {
      headers: { Authorization: "Bearer cloud-key" }
    });
  });

  it("uses the local tags endpoint without authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: "qwen2.5vl:7b" }]
    })));

    await expect(listOllamaModels({ provider: "local", fetchImpl })).resolves.toEqual([{ name: "qwen2.5vl:7b" }]);

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/tags", "http://127.0.0.1:11434"), undefined);
  });

  it("requires an API key for Cloud", async () => {
    await expect(listOllamaModels({ provider: "cloud" })).rejects.toThrow("Ollama Cloud API key is required.");
  });
});

describe("generateOllamaPrompt", () => {
  it("sends the Cloud prompt and image with bearer authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "  generated prompt  " })));

    await expect(generateOllamaPrompt({
      provider: "cloud",
      apiKey: "cloud-key",
      model: "gemma3",
      prompt: "Describe this image.",
      imageBase64: "image-bytes",
      fetchImpl
    })).resolves.toBe("generated prompt");

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/generate", "https://ollama.com"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer cloud-key"
      },
      body: JSON.stringify({
        model: "gemma3",
        prompt: "Describe this image.",
        images: ["image-bytes"],
        stream: false
      })
    });
  });

  it("sends the local prompt and image without bearer authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "local prompt" })));

    await expect(generateOllamaPrompt({
      provider: "local",
      model: "qwen2.5vl:7b",
      prompt: "Describe this image.",
      imageBase64: "image-bytes",
      fetchImpl
    })).resolves.toBe("local prompt");

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/generate", "http://127.0.0.1:11434"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5vl:7b",
        prompt: "Describe this image.",
        images: ["image-bytes"],
        stream: false
      })
    });
  });
});
