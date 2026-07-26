import { describe, expect, it } from "vitest";
import type { PromptMediaInput } from "./promptTypes";
import { createRunningHubGenerationJobs, prepareRunningHubGenerationJobs } from "./runningHubJobs";

const sourceImage: PromptMediaInput = {
  id: "source-image",
  label: "Source image",
  imagePath: "/input/source.jpg",
  sourceKind: "photo"
};

const sourceVideo: PromptMediaInput = {
  id: "source-video",
  label: "Source video",
  imagePath: "/input/first-frame.jpg",
  videoPath: "/input/source.mp4",
  sourceKind: "video-first-frame"
};

const generatedImage: PromptMediaInput = {
  id: "generated-image",
  label: "Generated image",
  imagePath: "/output/generated.png",
  generatedImagePath: "/output/generated.png",
  sourceKind: "photo"
};

describe("createRunningHubGenerationJobs", () => {
  it("creates a video-only job without requiring a prompt or generated image", () => {
    expect(createRunningHubGenerationJobs({
      bindings: [{ nodeId: "18", fieldName: "video", studioId: "3" }],
      selectedMedia: [sourceVideo],
      promptsByMediaId: new Map()
    })).toEqual([{
      media: sourceVideo
    }]);
  });

  it("creates an image-only job without requiring a prompt", () => {
    expect(createRunningHubGenerationJobs({
      bindings: [{ nodeId: "39", fieldName: "image", studioId: "1" }],
      selectedMedia: [sourceImage],
      promptsByMediaId: new Map()
    })).toEqual([{
      media: sourceImage
    }]);
  });

  it("uses a selected generated image when Studio ID 4 is configured", () => {
    expect(createRunningHubGenerationJobs({
      bindings: [{ nodeId: "44", fieldName: "image", studioId: "4" }],
      selectedMedia: [generatedImage],
      promptsByMediaId: new Map()
    })).toEqual([{
      media: generatedImage,
      generatedImage
    }]);
  });

  it("requires prompt text only when Studio ID 2 or 5 is configured", () => {
    expect(() => createRunningHubGenerationJobs({
      bindings: [{ nodeId: "6", fieldName: "text", studioId: "5" }],
      selectedMedia: [sourceVideo],
      promptsByMediaId: new Map()
    })).toThrow("prompt");

    expect(createRunningHubGenerationJobs({
      bindings: [{ nodeId: "6", fieldName: "text", studioId: "5" }],
      selectedMedia: [sourceVideo],
      promptsByMediaId: new Map([["source-video", "Animate this"]])
    })).toEqual([{
      media: sourceVideo,
      prompt: "Animate this"
    }]);
  });

  it("combines one selected generated image with each required source input", () => {
    expect(createRunningHubGenerationJobs({
      bindings: [
        { nodeId: "18", fieldName: "video", studioId: "3" },
        { nodeId: "44", fieldName: "image", studioId: "4" }
      ],
      selectedMedia: [sourceVideo, generatedImage],
      promptsByMediaId: new Map()
    })).toEqual([{
      media: sourceVideo,
      generatedImage
    }]);
  });

  it("uses the separately selected source image for an image-and-video workflow", () => {
    expect(createRunningHubGenerationJobs({
      bindings: [
        { nodeId: "18", fieldName: "video", studioId: "3" },
        { nodeId: "39", fieldName: "image", studioId: "1" }
      ],
      selectedMedia: [sourceImage, sourceVideo],
      promptsByMediaId: new Map()
    })).toEqual([{
      media: sourceVideo,
      sourceImage
    }]);
  });

  it("stores an automatically generated prompt before forwarding the same text to image generation", async () => {
    const editorPrompts = new Map([
      ["source-image", { value: "Portrait lighting", managedPrefix: "Portrait lighting" }],
    ]);
    const generationTrace: string[] = [];

    const jobs = await prepareRunningHubGenerationJobs({
      bindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "6", fieldName: "text", studioId: "2" },
      ],
      selectedMedia: [sourceImage],
      promptEntriesByMediaId: editorPrompts,
      studioActionButtons: [
        { id: "text-action", label: "Text", type: "text", presetId: "ol-1", order: 0 },
        { id: "image-action", label: "Image", type: "image", presetId: "rh-1", order: 1 },
      ],
      ollamaPresets: [
        { id: "ol-1", displayId: "OL01", provider: "local", model: "gemma3", promptInstruction: "Describe the image." },
      ],
      hasOllamaCloudApiKey: false,
      generateAndStorePrompt: async (media, ollamaPresetId) => {
        generationTrace.push(`${media.id}:${ollamaPresetId}`);
        const value = "Portrait lighting\nGenerated description";
        editorPrompts.set(media.id, { value, managedPrefix: "Portrait lighting" });
        return value;
      },
    });

    expect(generationTrace).toEqual(["source-image:ol-1"]);
    expect(editorPrompts.get("source-image")?.value).toBe("Portrait lighting\nGenerated description");
    expect(jobs).toEqual([{
      media: sourceImage,
      prompt: "Portrait lighting\nGenerated description",
    }]);
  });

  it("keeps an existing edited prompt without generating another one", async () => {
    const jobs = await prepareRunningHubGenerationJobs({
      bindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "6", fieldName: "text", studioId: "2" },
      ],
      selectedMedia: [sourceImage],
      promptEntriesByMediaId: new Map([
        ["source-image", { value: "My edited prompt", managedPrefix: "" }],
      ]),
      studioActionButtons: [
        { id: "text-action", label: "Text", type: "text", presetId: "ol-1", order: 0 },
      ],
      ollamaPresets: [
        { id: "ol-1", displayId: "OL01", provider: "local", model: "gemma3", promptInstruction: "Describe the image." },
      ],
      hasOllamaCloudApiKey: false,
      generateAndStorePrompt: async () => {
        throw new Error("Existing prompt must not be regenerated.");
      },
    });

    expect(jobs).toEqual([{
      media: sourceImage,
      prompt: "My edited prompt",
    }]);
  });

  it("generates prompts only for job media and not for auxiliary workflow inputs", async () => {
    const generatedFor: string[] = [];

    const jobs = await prepareRunningHubGenerationJobs({
      bindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "6", fieldName: "text", studioId: "2" },
        { nodeId: "44", fieldName: "generated", studioId: "4" },
      ],
      selectedMedia: [sourceImage, generatedImage],
      promptEntriesByMediaId: new Map(),
      studioActionButtons: [
        { id: "text-action", label: "Text", type: "text", presetId: "ol-1", order: 0 },
      ],
      ollamaPresets: [
        { id: "ol-1", displayId: "OL01", provider: "local", model: "gemma3", promptInstruction: "Describe the image." },
      ],
      hasOllamaCloudApiKey: false,
      generateAndStorePrompt: async (media) => {
        generatedFor.push(media.id);
        return `Prompt for ${media.id}`;
      },
    });

    expect(generatedFor).toEqual(["source-image"]);
    expect(jobs).toEqual([{
      media: sourceImage,
      generatedImage,
      prompt: "Prompt for source-image",
    }]);
  });

  it("skips an incomplete text preset when a later configured preset is available", async () => {
    const generatedWith: string[] = [];

    await prepareRunningHubGenerationJobs({
      bindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "6", fieldName: "text", studioId: "2" },
      ],
      selectedMedia: [sourceImage],
      promptEntriesByMediaId: new Map(),
      studioActionButtons: [
        { id: "invalid-text", label: "Invalid", type: "text", presetId: "ol-invalid", order: 0 },
        { id: "valid-text", label: "Valid", type: "text", presetId: "ol-valid", order: 1 },
      ],
      ollamaPresets: [
        { id: "ol-invalid", displayId: "OL01", provider: "local", model: "", promptInstruction: "" },
        { id: "ol-valid", displayId: "OL02", provider: "local", model: "gemma3", promptInstruction: "Describe the image." },
      ],
      hasOllamaCloudApiKey: false,
      generateAndStorePrompt: async (_media, ollamaPresetId) => {
        generatedWith.push(ollamaPresetId);
        return "Generated description";
      },
    });

    expect(generatedWith).toEqual(["ol-valid"]);
  });
});
