import { describe, expect, it } from "vitest";
import type { ImportItem } from "./importTypes";
import { createMediaMaterials } from "./mediaMaterials";

describe("createMediaMaterials", () => {
  it("creates deterministic material ids for images, videos, and first frames", () => {
    const item: ImportItem = {
      id: "post-1",
      sourceUrl: "https://www.instagram.com/p/example/",
      mediaType: "carousel",
      status: "ready",
      createdAt: "2026-06-26T10:00:00.000Z",
      files: {},
      assets: [
        {
          id: "asset-1",
          mediaType: "image",
          files: {
            image: "/input/20260626/post-1/image-001.jpg"
          }
        },
        {
          id: "asset-2",
          mediaType: "video",
          files: {
            video: "/input/20260626/post-1/video-001.mp4",
            firstFrame: "/input/20260626/post-1/video-001-first-frame.jpg"
          }
        }
      ]
    };

    expect(createMediaMaterials(item).map((material) => material.id)).toEqual([
      "post-1:asset-1:image",
      "post-1:asset-2:video",
      "post-1:asset-2:first-frame"
    ]);
  });
});
