import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearConnectionKey,
  cleanupDuplicateImports,
  generateImagePrompts,
  generateImages,
  getConnectionKey,
  importInstagramUrl,
  listOllamaModels,
  listImports,
  resetMediaSession,
  saveConnectionKey,
  uploadLocalImage
} from "./api";

describe("uploadLocalImage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the selected file directly to the local upload endpoint", async () => {
    const file = new File(["image"], "reference.png", { type: "image/png" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      item: { id: "local-1", assets: [], files: {}, status: "ready", mediaType: "image", createdAt: "2026-07-15", sourceUrl: "local://reference.png" },
      session: { itemIds: ["local-1"], sceneBibles: [], mediaSceneMap: {} }
    })));

    await uploadLocalImage(file);

    expect(fetchSpy).toHaveBeenCalledWith("/api/imports/upload-image", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "image/png", "X-File-Name": "reference.png" }),
      body: file
    }));
  });
});

describe("generateImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts each selected media item with its final edited prompt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
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

    const media = {
      id: "item:asset:first-frame",
      label: "First frame",
      imagePath: "/input/20260625/import/first-frame-001.jpg",
      sourceKind: "video-first-frame" as const,
      caption: "Caption"
    };

    await expect(generateImages([{ media, prompt: "edited prompt" }])).resolves.toEqual({
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
        jobs: [{ media, prompt: "edited prompt" }]
      })
    });
  });

  it("wraps browser fetch failures with a local API diagnostic", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(generateImages([{
      prompt: "edited prompt",
      media: {
      id: "item:asset:image",
      label: "Image",
      imagePath: "/input/20260625/import/image-001.jpg",
      sourceKind: "photo"
      }
    }])).rejects.toThrow("Local API is not reachable");
  });
});

describe("generateImagePrompts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the updated media session produced by prompt generation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      prompts: [{
        mediaId: "item:asset:image",
        label: "Image",
        prompt: "{\"high_level_description\":\"test\"}"
      }],
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
      prompts: [{
        mediaId: "item:asset:image",
        prompt: "{\"high_level_description\":\"test\"}"
      }],
      session: {
        itemIds: ["post-1"],
        mediaSceneMap: {
          "item:asset:image": "scene_001_bedroom"
        }
      }
    });
  });
});

describe("connections API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses dedicated key routes and requests Ollama models for the selected provider", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: "cloud-key" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "gemma3" }] })));

    await expect(getConnectionKey("ollamaCloudApiKey")).resolves.toBe("cloud-key");
    await expect(saveConnectionKey("ollamaCloudApiKey", "replacement-key")).resolves.toBeUndefined();
    await expect(clearConnectionKey("ollamaCloudApiKey")).resolves.toBeUndefined();
    await expect(listOllamaModels("cloud")).resolves.toEqual([{ name: "gemma3" }]);

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/connections/keys/ollamaCloudApiKey");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/connections/keys/ollamaCloudApiKey", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "replacement-key" })
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/connections/keys/ollamaCloudApiKey", { method: "DELETE" });
    expect(fetchSpy).toHaveBeenNthCalledWith(4, "/api/ollama/models?provider=cloud");
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
