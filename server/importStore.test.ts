import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportItem } from "../src/lib/importTypes";
import { ImportStore } from "./importStore";

let tempDir: string;

const sampleItem: ImportItem = {
  id: "20260624-153000-abc123",
  sourceUrl: "https://www.instagram.com/reel/example/",
  mediaType: "video",
  status: "ready",
  createdAt: "2026-06-24T15:30:00.000Z",
  files: {
    video: "data/imports/20260624-153000-abc123/media.mp4",
    firstFrame: "data/imports/20260624-153000-abc123/first_frame.jpg",
    metadata: "data/imports/20260624-153000-abc123/yt_dlp.info.json"
  },
  assets: [
    {
      id: "media",
      mediaType: "video",
      files: {
        video: "data/imports/20260624-153000-abc123/media.mp4",
        firstFrame: "data/imports/20260624-153000-abc123/first_frame.jpg",
        metadata: "data/imports/20260624-153000-abc123/yt_dlp.info.json"
      }
    }
  ]
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "import-store-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ImportStore", () => {
  it("returns an empty list when index does not exist", async () => {
    const store = new ImportStore(tempDir);

    await expect(store.listItems()).resolves.toEqual([]);
  });

  it("saves an item and reads it back", async () => {
    const store = new ImportStore(tempDir);

    await store.saveItem(sampleItem);

    await expect(store.listItems()).resolves.toEqual([sampleItem]);
  });
});
