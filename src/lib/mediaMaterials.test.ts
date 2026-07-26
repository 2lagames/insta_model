import { describe, expect, it } from "vitest";
import type { ImportItem } from "./importTypes";
import { createMediaMaterials, createSessionMediaMaterials } from "./mediaMaterials";

describe("createMediaMaterials", () => {
  it("creates separate video and first-frame materials for a Reel", () => {
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
      "post-1:asset-2:first-frame",
      "post-1:asset-2:video"
    ]);
    expect(createMediaMaterials(item)[1]?.files).toMatchObject({
      image: "/input/20260626/post-1/video-001-first-frame.jpg",
      video: "/input/20260626/post-1/video-001.mp4"
    });
    expect(createMediaMaterials(item)[1]?.selectionGroupId).toBe("post-1:asset-2");
    expect(createMediaMaterials(item)[2]?.selectionGroupId).toBe("post-1:asset-2");
  });
});

describe("createSessionMediaMaterials", () => {
  it("numbers images and Reels independently in session order", () => {
    const imageItem: ImportItem = {
      id: "post-1",
      sourceUrl: "https://www.instagram.com/p/example/",
      mediaType: "carousel",
      status: "ready",
      createdAt: "2026-06-26T10:00:00.000Z",
      files: {},
      assets: [
        { id: "image-1", mediaType: "image", files: { image: "/input/image-1.jpg" } },
        { id: "image-2", mediaType: "image", files: { image: "/input/image-2.jpg" } }
      ]
    };
    const videoItem: ImportItem = {
      id: "post-2",
      sourceUrl: "https://www.instagram.com/p/example-2/",
      mediaType: "video",
      status: "ready",
      createdAt: "2026-06-26T10:01:00.000Z",
      files: {},
      assets: [
        { id: "video-1", mediaType: "video", files: { video: "/input/video-1.mp4", firstFrame: "/input/frame-1.jpg" } },
        { id: "video-2", mediaType: "video", files: { video: "/input/video-2.mp4", firstFrame: "/input/frame-2.jpg" } }
      ]
    };

    expect(createSessionMediaMaterials([imageItem, videoItem], ["post-1", "post-2"], imageItem, false).map((material) => material.label)).toEqual([
      "IMAGE 1",
      "IMAGE 2",
      "IMAGE 3",
      "REEL 1",
      "IMAGE 4",
      "REEL 2"
    ]);
  });
});
