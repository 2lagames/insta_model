import { describe, expect, it } from "vitest";
import type { PromptMediaInput } from "./promptTypes";
import { createRunningHubGenerationJobs } from "./runningHubJobs";

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
});
