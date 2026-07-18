import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildApifyInstagramScraperUrl,
  createImportItemFromApifyPosts,
  importInstagramUrl,
  materializeImportAssets
} from "./instagramImporter";

const postUrl = "https://www.instagram.com/p/DZ-boFRkeAm/";

describe("buildApifyInstagramScraperUrl", () => {
  it("builds the official actor synchronous dataset endpoint without a token in the URL", () => {
    expect(buildApifyInstagramScraperUrl().toString()).toBe(
      "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items"
    );
  });
});

describe("createImportItemFromApifyPosts", () => {
  it("extracts only all carousel image URLs and drops the caption and video fields", () => {
    const item = createImportItemFromApifyPosts(postUrl, [{
      type: "Sidecar",
      shortCode: "DZ-boFRkeAm",
      ownerUsername: "example_creator",
      caption: "This must never be persisted",
      displayUrl: "https://cdn.example.com/cover.jpg",
      carouselImages: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
        "https://cdn.example.com/3.jpg"
      ],
      videoUrl: "https://cdn.example.com/should-not-download.mp4"
    }], "2026-07-18T10:00:00.000Z", "import-123");

    expect(item.provider).toBe("apify");
    expect(item.mediaType).toBe("carousel");
    expect(item.title).toBeUndefined();
    expect(item.caption).toBeUndefined();
    expect(item.assets).toEqual([
      { id: "DZ-boFRkeAm-image-001", mediaType: "image", files: { image: "https://cdn.example.com/1.jpg", thumbnail: "https://cdn.example.com/1.jpg" } },
      { id: "DZ-boFRkeAm-image-002", mediaType: "image", files: { image: "https://cdn.example.com/2.jpg", thumbnail: "https://cdn.example.com/2.jpg" } },
      { id: "DZ-boFRkeAm-image-003", mediaType: "image", files: { image: "https://cdn.example.com/3.jpg", thumbnail: "https://cdn.example.com/3.jpg" } }
    ]);
  });

  it("uses the image post display URL when the actor returns no image array", () => {
    const item = createImportItemFromApifyPosts(postUrl, [{
      type: "Image",
      shortCode: "DZ-boFRkeAm",
      displayUrl: "https://cdn.example.com/one.jpg"
    }], "2026-07-18T10:00:00.000Z", "import-123");

    expect(item.mediaType).toBe("image");
    expect(item.assets).toEqual([
      { id: "DZ-boFRkeAm-image-001", mediaType: "image", files: { image: "https://cdn.example.com/one.jpg", thumbnail: "https://cdn.example.com/one.jpg" } }
    ]);
  });

  it("extracts a reel video URL without keeping its caption or cover URL", () => {
    const item = createImportItemFromApifyPosts("https://www.instagram.com/reel/example/", [{
      type: "Video",
      shortCode: "reel-example",
      caption: "This must never be persisted",
      displayUrl: "https://cdn.example.com/reel-cover.jpg",
      videoUrl: "https://cdn.example.com/reel.mp4"
    }], "2026-07-18T10:00:00.000Z", "import-123");

    expect(item.mediaType).toBe("video");
    expect(item.caption).toBeUndefined();
    expect(item.assets).toEqual([
      { id: "reel-example-video-001", mediaType: "video", files: { video: "https://cdn.example.com/reel.mp4" } }
    ]);
  });
});

describe("materializeImportAssets", () => {
  it("downloads photo assets into input date folders", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "input-media-"));
    const inputDir = join(tempDir, "input");

    try {
      const assets = await materializeImportAssets([{
        id: "photo-post",
        mediaType: "image",
        files: { image: "https://cdn.example.com/photo.jpg" }
      }], {
        inputDir,
        importId: "import-123",
        createdAt: "2026-07-18T10:00:00.000Z",
        fetchImpl: (async () => new Response(Buffer.from("photo-bytes"), {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        })) as typeof fetch
      });

      expect(assets[0]?.files.image).toBe("/input/20260718/import-123/image-001.jpg");
      expect(assets[0]?.files.thumbnail).toBe("/input/20260718/import-123/image-001.jpg");
      await expect(readFile(join(inputDir, "20260718", "import-123", "image-001.jpg"), "utf8"))
        .resolves.toBe("photo-bytes");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("downloads reel videos and creates a local first-frame preview", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "input-video-"));
    const inputDir = join(tempDir, "input");

    try {
      const assets = await materializeImportAssets([{
        id: "reel-video",
        mediaType: "video",
        files: { video: "https://cdn.example.com/reel.mp4" }
      }], {
        inputDir,
        importId: "import-123",
        createdAt: "2026-07-18T10:00:00.000Z",
        fetchImpl: (async () => new Response(Buffer.from("video-bytes"), { status: 200 })) as typeof fetch,
        generateFirstFrame: async (_videoPath, firstFramePath) => {
          await writeFile(firstFramePath, "frame-bytes");
        }
      });

      expect(assets[0]?.files).toEqual({
        video: "/input/20260718/import-123/video-001.mp4",
        firstFrame: "/input/20260718/import-123/first-frame-001.jpg",
        thumbnail: "/input/20260718/import-123/first-frame-001.jpg"
      });
      await expect(readFile(join(inputDir, "20260718", "import-123", "video-001.mp4"), "utf8")).resolves.toBe("video-bytes");
      await expect(readFile(join(inputDir, "20260718", "import-123", "first-frame-001.jpg"), "utf8")).resolves.toBe("frame-bytes");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("importInstagramUrl", () => {
  it("calls the actor in reels mode and materializes the video", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "apify-reel-"));
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      requested.push({ url: String(url), init });
      if (String(url).startsWith("https://api.apify.com/")) {
        return new Response(JSON.stringify([{
          type: "Video",
          shortCode: "reel-example",
          videoUrl: "https://cdn.example.com/reel.mp4",
          caption: "discarded"
        }]), { status: 200 });
      }
      return new Response(Buffer.from("video-bytes"), { status: 200 });
    }) as typeof fetch;

    try {
      const item = await importInstagramUrl("https://www.instagram.com/reel/example/", {
        dataDir: join(tempDir, "data"),
        inputDir: join(tempDir, "input"),
        apifyApiToken: "apify_token_123",
        fetchImpl,
        generateFirstFrame: async (_videoPath, firstFramePath) => {
          await writeFile(firstFramePath, "frame-bytes");
        }
      });

      expect(JSON.parse(String(requested[0]?.init?.body))).toEqual({
        directUrls: ["https://www.instagram.com/reel/example/"],
        resultsType: "reels",
        resultsLimit: 1
      });
      expect(item.mediaType).toBe("video");
      expect(item.assets[0]?.files.video).toMatch(/^\/input\//);
      expect(item.assets[0]?.files.firstFrame).toMatch(/^\/input\//);
      expect(item.caption).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("calls the official actor for one post and materializes only its photos", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "apify-import-"));
    const dataDir = join(tempDir, "data");
    const inputDir = join(tempDir, "input");
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      requested.push({ url: String(url), init });
      if (String(url).startsWith("https://api.apify.com/")) {
        return new Response(JSON.stringify([{
          type: "Sidecar",
          shortCode: "DZ-boFRkeAm",
          images: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
          caption: "discarded"
        }]), { status: 200 });
      }
      return new Response(Buffer.from("photo-bytes"), { status: 200 });
    }) as typeof fetch;

    try {
      const item = await importInstagramUrl(postUrl, {
        dataDir,
        inputDir,
        apifyApiToken: "apify_token_123",
        fetchImpl
      });

      expect(JSON.parse(String(requested[0]?.init?.body))).toEqual({
        directUrls: [postUrl],
        resultsType: "posts",
        resultsLimit: 1
      });
      expect(requested[0]?.init?.headers).toEqual({
        authorization: "Bearer apify_token_123",
        "content-type": "application/json"
      });
      expect(item.assets).toHaveLength(2);
      expect(item.caption).toBeUndefined();
      await expect(readFile(join(dataDir, "imports", item.id, "apify-media.json"), "utf8"))
        .resolves.toBe(JSON.stringify({
          sourceUrl: postUrl,
          assets: item.assets.map(({ files, ...asset }) => {
            const { metadata: _metadata, ...mediaFiles } = files;
            return { ...asset, files: mediaFiles };
          })
        }, null, 2));
      await expect(readdir(join(dataDir, "imports", item.id))).resolves.not.toContain("apify-response.json");
      await expect(readFile(join(dataDir, "imports", item.id, "source.json"), "utf8"))
        .resolves.toContain("\"provider\": \"apify\"");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not create final folders when photo download fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "failed-import-"));
    const dataDir = join(tempDir, "data");
    const inputDir = join(tempDir, "input");
    const fetchImpl = (async (url: URL | string) => {
      if (String(url).startsWith("https://api.apify.com/")) {
        return new Response(JSON.stringify([{
          type: "Image",
          displayUrl: "https://cdn.example.com/image.jpg"
        }]), { status: 200 });
      }
      throw new TypeError("network reset");
    }) as typeof fetch;

    try {
      await expect(importInstagramUrl(postUrl, {
        dataDir,
        inputDir,
        apifyApiToken: "apify_token_123",
        fetchImpl
      })).rejects.toThrow("network reset");

      await expect(readdir(inputDir)).rejects.toThrow();
      await expect(readdir(join(dataDir, "imports"))).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
