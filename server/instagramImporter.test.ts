import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildScrapeCreatorsPostUrl,
  checkScrapeCreatorsPostAccess,
  createImportItemFromScrapeCreatorsPost,
  formatScrapeCreatorsForbiddenError,
  importInstagramUrl,
  materializeImportAssets
} from "./instagramImporter";

const postUrl = "https://www.instagram.com/p/DZ-boFRkeAm/";

describe("buildScrapeCreatorsPostUrl", () => {
  it("builds the post lookup URL with media download enabled", () => {
    const url = buildScrapeCreatorsPostUrl(postUrl);

    expect(url.toString()).toBe(
      "https://api.scrapecreators.com/v1/instagram/post?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FDZ-boFRkeAm%2F&trim=false&download_media=true"
    );
  });

  it("sends a canonical Instagram URL without share query params", () => {
    const url = buildScrapeCreatorsPostUrl(`${postUrl}?igsh=MWRjNWg1MGkxMGppMA==`);

    expect(url.searchParams.get("url")).toBe(postUrl);
  });

  it("can build a non-download access check URL", () => {
    const url = buildScrapeCreatorsPostUrl(postUrl, { downloadMedia: false });

    expect(url.searchParams.get("download_media")).toBe("false");
  });
});

describe("checkScrapeCreatorsPostAccess", () => {
  it("checks access without requesting media download", async () => {
    let requestedUrl: URL | undefined;
    const fetchImpl = (async (url: URL) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as typeof fetch;

    await expect(checkScrapeCreatorsPostAccess(postUrl, "api-key", fetchImpl)).resolves.toEqual({
      ok: true,
      sourceUrl: postUrl
    });
    expect(requestedUrl?.searchParams.get("download_media")).toBe("false");
  });
});

describe("formatScrapeCreatorsForbiddenError", () => {
  it("explains age-restricted media as a provider limitation", () => {
    const message = formatScrapeCreatorsForbiddenError(
      "https://www.instagram.com/reel/example/",
      {
        error: "forbidden",
        errorStatus: 403,
        credits_remaining: 999,
        message: "Shoot it looks like the post is age restricted :("
      },
      "{\"error\":\"forbidden\"}"
    );

    expect(message).toContain("age-restricted");
    expect(message).toContain("only scrapes public data");
    expect(message).toContain("authenticated browser/cookies fallback");
  });
});

describe("createImportItemFromScrapeCreatorsPost", () => {
  it("extracts carousel photos and caption text", () => {
    const item = createImportItemFromScrapeCreatorsPost(postUrl, {
      data: {
        xdt_shortcode_media: {
          shortcode: "DZ-boFRkeAm",
          display_url: "https://cdn.example.com/cover.jpg",
          edge_media_to_caption: {
            edges: [{ node: { text: "Long post caption\nwith multiple lines" } }]
          },
          edge_sidecar_to_children: {
            edges: [
              { node: { id: "photo-one", is_video: false, display_url: "https://cdn.example.com/1.jpg" } },
              { node: { id: "photo-two", is_video: false, display_url: "https://cdn.example.com/2.jpg" } },
              { node: { id: "photo-three", is_video: false, display_url: "https://cdn.example.com/3.jpg" } },
              { node: { id: "photo-four", is_video: false, display_url: "https://cdn.example.com/4.jpg" } }
            ]
          }
        }
      }
    }, "2026-06-25T10:00:00.000Z");

    expect(item.mediaType).toBe("carousel");
    expect(item.caption).toBe("Long post caption\nwith multiple lines");
    expect(item.assets).toHaveLength(4);
    expect(item.assets.map((asset) => asset.files.image)).toEqual([
      "https://cdn.example.com/1.jpg",
      "https://cdn.example.com/2.jpg",
      "https://cdn.example.com/3.jpg",
      "https://cdn.example.com/4.jpg"
    ]);
  });

  it("extracts video URL and first-frame thumbnail", () => {
    const item = createImportItemFromScrapeCreatorsPost("https://www.instagram.com/reel/video-post/", {
      data: {
        xdt_shortcode_media: {
          shortcode: "video-post",
          is_video: true,
          video_url: "https://cdn.example.com/video.mp4",
          thumbnail_src: "https://cdn.example.com/frame.jpg",
          edge_media_to_caption: { edges: [] }
        }
      }
    }, "2026-06-25T10:00:00.000Z");

    expect(item.sourceKind).toBe("reel");
    expect(item.mediaType).toBe("video");
    expect(item.assets).toHaveLength(1);
    expect(item.assets[0]?.files.video).toBe("https://cdn.example.com/video.mp4");
    expect(item.assets[0]?.files.firstFrame).toBe("https://cdn.example.com/frame.jpg");
  });
});

describe("materializeImportAssets", () => {
  it("downloads video assets into input date folders and creates first-frame thumbnails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "input-media-"));
    const inputDir = join(tempDir, "input");

    try {
      const assets = await materializeImportAssets([
        {
          id: "video-post",
          mediaType: "video",
          files: {
            video: "https://cdn.example.com/video.mp4"
          }
        }
      ], {
        inputDir,
        importId: "import-123",
        createdAt: "2026-06-25T10:00:00.000Z",
        fetchImpl: (async () => new Response(Buffer.from("video-bytes"), {
          status: 200,
          headers: { "content-type": "video/mp4" }
        })) as typeof fetch,
        generateFirstFrame: async (_videoPath, framePath) => {
          await mkdir(join(inputDir, "20260625", "import-123"), { recursive: true });
          await writeFile(framePath, "frame-bytes");
        }
      });

      expect(assets[0]?.files.video).toBe("/input/20260625/import-123/video-001.mp4");
      expect(assets[0]?.files.firstFrame).toBe("/input/20260625/import-123/first-frame-001.jpg");
      expect(assets[0]?.files.thumbnail).toBe("/input/20260625/import-123/first-frame-001.jpg");
      await expect(readFile(join(inputDir, "20260625", "import-123", "video-001.mp4"), "utf8"))
        .resolves.toBe("video-bytes");
      await expect(readFile(join(inputDir, "20260625", "import-123", "first-frame-001.jpg"), "utf8"))
        .resolves.toBe("frame-bytes");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("importInstagramUrl", () => {
  it("does not create final folders when media download fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "failed-import-"));
    const dataDir = join(tempDir, "data");
    const inputDir = join(tempDir, "input");
    const fetchImpl = (async (url: URL | string) => {
      if (String(url).startsWith("https://api.scrapecreators.com/")) {
        return new Response(JSON.stringify({
          data: {
            xdt_shortcode_media: {
              shortcode: "failed-post",
              display_url: "https://cdn.example.com/image.jpg"
            }
          }
        }), { status: 200 });
      }
      throw new TypeError("network reset");
    }) as typeof fetch;

    try {
      await expect(importInstagramUrl(postUrl, {
        dataDir,
        inputDir,
        scrapeCreatorsApiKey: "api-key",
        fetchImpl
      })).rejects.toThrow("network reset");

      await expect(readdir(inputDir)).rejects.toThrow();
      await expect(readdir(join(dataDir, "imports"))).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
