import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const generatedItem: ImportItem = {
  ...sampleItem,
  id: "20260626-120000-runninghub",
  sourceUrl: "runninghub://task/example",
  mediaType: "image",
  provider: "runninghub",
  files: {
    image: "output/20260626/generated.png"
  },
  assets: [
    {
      id: "generated-1",
      mediaType: "image",
      files: {
        image: "output/20260626/generated.png"
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

  it("clears prompt texts for a new session and keeps them when the session is extended", async () => {
    const store = new ImportStore(tempDir);
    await store.writeCurrentSession({
      itemIds: ["old"],
      sceneBibles: [],
      mediaSceneMap: {},
      promptTexts: { "old:image": "saved" }
    });

    await store.startCurrentSession("local-1");

    const startedIndex = JSON.parse(await readFile(join(tempDir, "imports", "index.json"), "utf8"));
    expect(startedIndex.currentSession).toEqual({
      itemIds: ["local-1"],
      sceneBibles: [],
      mediaSceneMap: {},
      promptTexts: {}
    });

    await store.writeCurrentSession({
      itemIds: ["local-1"],
      sceneBibles: [],
      mediaSceneMap: {},
      promptTexts: { "local-1:image": "final prompt" }
    });
    await store.appendToCurrentSession("generated-1");

    await expect(store.readCurrentSession()).resolves.toMatchObject({
      itemIds: ["local-1", "generated-1"],
      promptTexts: { "local-1:image": "final prompt" }
    });

    await store.resetCurrentSession();
    await expect(store.readCurrentSession()).resolves.toMatchObject({ promptTexts: {} });
  });

  it("finds the newest ready import for an Instagram URL", async () => {
    const store = new ImportStore(tempDir);
    const olderItem: ImportItem = {
      ...sampleItem,
      id: "older-import",
      sourceUrl: "https://www.instagram.com/p/reused-post/",
      createdAt: "2026-06-24T15:30:00.000Z"
    };
    const newestItem: ImportItem = {
      ...olderItem,
      id: "newest-import",
      createdAt: "2026-06-25T15:30:00.000Z"
    };

    await store.saveItem(olderItem);
    await store.saveItem(generatedItem);
    await store.saveItem(newestItem);

    await expect(store.findNewestBySourceUrl(olderItem.sourceUrl)).resolves.toEqual(newestItem);
  });

  it("reuses the newest import whose local media files still exist", async () => {
    const inputDir = join(tempDir, "input");
    const store = new ImportStore(tempDir, inputDir);
    const olderItem = createLocalImageItem("older-import", "2026-06-24T15:30:00.000Z");
    const newestItem = createLocalImageItem("newest-import", "2026-06-25T15:30:00.000Z");

    await store.saveItem(olderItem);
    await store.saveItem(newestItem);
    await writeImportFiles(tempDir, inputDir, olderItem);

    await expect(store.findNewestReusableBySourceUrl(olderItem.sourceUrl)).resolves.toEqual(olderItem);
  });

  it("removes older healthy duplicates but keeps the newest import for each post", async () => {
    const inputDir = join(tempDir, "input");
    const store = new ImportStore(tempDir, inputDir);
    const olderItem = createLocalImageItem("older-import", "2026-06-24T15:30:00.000Z");
    const newestItem = createLocalImageItem("newest-import", "2026-06-25T15:30:00.000Z");
    const otherPost = {
      ...createLocalImageItem("other-import", "2026-06-26T15:30:00.000Z"),
      sourceUrl: "https://www.instagram.com/p/other-post/"
    };

    for (const item of [olderItem, newestItem, otherPost]) {
      await store.saveItem(item);
      await writeImportFiles(tempDir, inputDir, item);
    }
    await store.saveItem(generatedItem);

    await expect(store.cleanupDuplicateInstagramImports()).resolves.toEqual({
      retainedItemIds: [newestItem.id],
      deletedItemIds: [olderItem.id]
    });
    await expect(store.listItems()).resolves.toEqual([generatedItem, otherPost, newestItem]);
    await expect(access(join(inputDir, "20260710", olderItem.id))).rejects.toThrow();
    await expect(access(join(tempDir, "imports", olderItem.id))).rejects.toThrow();
    await expect(access(join(inputDir, "20260710", newestItem.id, "image.jpg"))).resolves.toBeUndefined();
    await expect(access(join(inputDir, "20260710", otherPost.id, "image.jpg"))).resolves.toBeUndefined();
  });

  it("persists the current media session across scraper import, generation, and reset", async () => {
    const store = new ImportStore(tempDir);

    await store.saveItem(sampleItem);
    await store.startCurrentSession(sampleItem.id);
    await expect(store.readCurrentSessionItemIds()).resolves.toEqual([sampleItem.id]);

    await store.saveItem(generatedItem);
    await store.appendToCurrentSession(generatedItem.id);
    await expect(store.readCurrentSessionItemIds()).resolves.toEqual([sampleItem.id, generatedItem.id]);

    await store.resetCurrentSession();
    await expect(store.readCurrentSessionItemIds()).resolves.toEqual([]);
  });

  it("persists scene bibles and media scene mapping in the current session", async () => {
    const store = new ImportStore(tempDir);
    const mediaId = `${sampleItem.id}:media:first-frame`;

    await store.writeCurrentSession({
      itemIds: [sampleItem.id],
      sceneBibles: [{
        id: "scene_001_bedroom",
        name: "Bedroom",
        sourceMediaIds: [mediaId],
        locationSignature: {
          locationType: "bright bedroom",
          environmentKind: "interior",
          keyObjects: ["wood headboard", "white bedding"],
          lighting: "soft daylight from the left",
          palette: ["cream", "wood", "white"],
          mood: "serene"
        },
        lockedJson: {
          high_level_description: "A photorealistic bedroom photoshoot.",
          style_description: {},
          compositional_deconstruction: {
            background: "Same bright bedroom.",
            elements: []
          }
        }
      }],
      mediaSceneMap: {
        [mediaId]: "scene_001_bedroom"
      }
    });

    await expect(store.readCurrentSession()).resolves.toMatchObject({
      itemIds: [sampleItem.id],
      mediaSceneMap: {
        [mediaId]: "scene_001_bedroom"
      }
    });
  });
});

function createLocalImageItem(id: string, createdAt: string): ImportItem {
  const imagePath = `/input/20260710/${id}/image.jpg`;
  return {
    id,
    sourceUrl: "https://www.instagram.com/p/reused-post/",
    mediaType: "image",
    status: "ready",
    createdAt,
    files: {
      image: imagePath,
      thumbnail: imagePath,
      metadata: `/media/imports/${id}/apify-media.json`
    },
    assets: [{
      id: "photo",
      mediaType: "image",
      files: {
        image: imagePath,
        thumbnail: imagePath,
        metadata: `/media/imports/${id}/apify-media.json`
      }
    }]
  };
}

async function writeImportFiles(dataDir: string, inputDir: string, item: ImportItem): Promise<void> {
  const imagePath = join(inputDir, "20260710", item.id, "image.jpg");
  const metadataPath = join(dataDir, "imports", item.id, "apify-media.json");
  await mkdir(join(inputDir, "20260710", item.id), { recursive: true });
  await mkdir(join(dataDir, "imports", item.id), { recursive: true });
  await Promise.all([
    writeFile(imagePath, "image"),
    writeFile(metadataPath, "metadata")
  ]);
}
