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
  it("sends the preset instruction as system and the Studio text as the user prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "  generated prompt  " })));

    await expect(generateOllamaPrompt({
      provider: "cloud",
      apiKey: "cloud-key",
      model: "gemma3",
      systemPrompt: "Return an Ideogram JSON prompt.",
      userPrompt: "Make the lighting warmer.",
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
        system: "Return an Ideogram JSON prompt.",
        prompt: "Make the lighting warmer.",
        images: ["image-bytes"],
        stream: false
      })
    });
  });

  it("uses a neutral user prompt when the Studio text is blank", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "local prompt" })));

    await generateOllamaPrompt({
      provider: "local",
      model: "qwen2.5vl:7b",
      systemPrompt: "Return an Ideogram JSON prompt.",
      userPrompt: "   ",
      imageBase64: "image-bytes",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/generate", "http://127.0.0.1:11434"), expect.objectContaining({
      body: JSON.stringify({
        model: "qwen2.5vl:7b",
        system: "Return an Ideogram JSON prompt.",
        prompt: "Process the attached image according to the system instructions.",
        images: ["image-bytes"],
        stream: false
      })
    }));
  });

  it("sends the local system prompt and image without bearer authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "local prompt" })));

    await expect(generateOllamaPrompt({
      provider: "local",
      model: "qwen2.5vl:7b",
      systemPrompt: "Describe this image.",
      imageBase64: "image-bytes",
      fetchImpl
    })).resolves.toBe("local prompt");

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/generate", "http://127.0.0.1:11434"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5vl:7b",
        system: "Describe this image.",
        prompt: "Process the attached image according to the system instructions.",
        images: ["image-bytes"],
        stream: false
      })
    });
  });

  it.each([500, 502])("retries one transient %s response before succeeding", async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "temporary Ollama failure" }),
        { status }
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: "recovered prompt" })));

    await expect(generateOllamaPrompt({
      provider: "cloud",
      apiKey: "cloud-key",
      model: "gemma4:31b",
      systemPrompt: "Describe this image.",
      imageBase64: "image-bytes",
      fetchImpl
    })).resolves.toBe("recovered prompt");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves the final Ollama reference after the retry also fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "Internal Server Error (ref: first-ref)" }),
        { status: 500 }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "Internal Server Error (ref: final-ref)" }),
        { status: 500 }
      ));

    await expect(generateOllamaPrompt({
      provider: "cloud",
      apiKey: "cloud-key",
      model: "gemma4:31b",
      systemPrompt: "Describe this image.",
      imageBase64: "image-bytes",
      fetchImpl
    })).rejects.toThrow("Ollama prompt generation failed with 500: {\"error\":\"Internal Server Error (ref: final-ref)\"}");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
