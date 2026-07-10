import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupDuplicateImports,
  generateImagePrompts,
  generateImages,
  importInstagramUrl,
  listImports,
  resetMediaSession
} from "./api";

describe("generateImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts selected media to the local image generation pipeline", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      prompt: "{\"high_level_description\":\"test\"}",
      item: {
        id: "generated-1",
        sourceUrl: "runninghub://task-1",
        mediaType: "carousel",
        status: "ready",
        createdAt: "2026-06-25T10:30:00.000Z",
        provider: "runninghub",
        files: { image: "/output/20260625/task-1-image-1.png" },
        assets: []
      }
    })));

    await expect(generateImages([{
      id: "item:asset:first-frame",
      label: "First frame",
      imagePath: "/input/20260625/import/first-frame-001.jpg",
      sourceKind: "video-first-frame",
      caption: "Caption"
    }])).resolves.toEqual({
      prompt: "{\"high_level_description\":\"test\"}",
      item: {
        id: "generated-1",
        sourceUrl: "runninghub://task-1",
        mediaType: "carousel",
        status: "ready",
        createdAt: "2026-06-25T10:30:00.000Z",
        provider: "runninghub",
        files: { image: "/output/20260625/task-1-image-1.png" },
        assets: []
      },
      session: {
        itemIds: [],
        sceneBibles: [],
        mediaSceneMap: {}
      }
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/generation/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        media: [{
          id: "item:asset:first-frame",
          label: "First frame",
          imagePath: "/input/20260625/import/first-frame-001.jpg",
          sourceKind: "video-first-frame",
          caption: "Caption"
        }]
      })
    });
  });

  it("wraps browser fetch failures with a local API diagnostic", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(generateImages([{
      id: "item:asset:image",
      label: "Image",
      imagePath: "/input/20260625/import/image-001.jpg",
      sourceKind: "photo"
    }])).rejects.toThrow("Local API is not reachable");
  });
});

describe("generateImagePrompts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the updated media session produced by prompt generation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      prompt: "{\"high_level_description\":\"test\"}",
      session: {
        itemIds: ["post-1"],
        sceneBibles: [{
          id: "scene_001_bedroom",
          name: "Bedroom",
          sourceMediaIds: ["item:asset:image"],
          locationSignature: {
            locationType: "bedroom",
            environmentKind: "interior",
            keyObjects: [],
            lighting: "soft daylight",
            palette: [],
            mood: "calm"
          },
          lockedJson: {}
        }],
        mediaSceneMap: {
          "item:asset:image": "scene_001_bedroom"
        }
      }
    })));

    await expect(generateImagePrompts([{
      id: "item:asset:image",
      label: "Image",
      imagePath: "/input/20260625/import/image-001.jpg",
      sourceKind: "photo"
    }])).resolves.toMatchObject({
      prompt: "{\"high_level_description\":\"test\"}",
      session: {
        itemIds: ["post-1"],
        mediaSceneMap: {
          "item:asset:image": "scene_001_bedroom"
        }
      }
    });
  });
});

describe("imports session API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns persisted session item ids with imported items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "post-1",
        sourceUrl: "https://www.instagram.com/p/example/",
        mediaType: "image",
        status: "ready",
        createdAt: "2026-06-26T08:00:00.000Z",
        files: {},
        assets: []
      }],
      sessionItemIds: ["post-1", "generated-1"]
    })));

    await expect(listImports()).resolves.toMatchObject({
      sessionItemIds: ["post-1", "generated-1"]
    });
  });

  it("persists media session reset through the backend endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      sessionItemIds: []
    })));

    await expect(resetMediaSession()).resolves.toEqual({
      itemIds: [],
      sceneBibles: [],
      mediaSceneMap: {}
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/imports/session/reset", { method: "POST" });
  });

  it("requests a fresh download only when force refresh is selected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      item: {
        id: "post-1",
        sourceUrl: "https://www.instagram.com/p/example/",
        mediaType: "image",
        status: "ready",
        createdAt: "2026-06-26T08:00:00.000Z",
        files: {},
        assets: []
      },
      reused: false
    })));

    await expect(importInstagramUrl("https://www.instagram.com/p/example/", { forceRefresh: true })).resolves.toMatchObject({
      item: { id: "post-1" },
      reused: false
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/imports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: "https://www.instagram.com/p/example/", forceRefresh: true })
    });
  });

  it("returns the items that remain after duplicate cleanup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [],
      retainedItemIds: ["newest-import"],
      deletedItemIds: ["older-import"]
    })));

    await expect(cleanupDuplicateImports()).resolves.toEqual({
      items: [],
      session: {
        itemIds: [],
        sceneBibles: [],
        mediaSceneMap: {}
      },
      retainedItemIds: ["newest-import"],
      deletedItemIds: ["older-import"]
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/imports/cleanup", { method: "POST" });
  });
});
