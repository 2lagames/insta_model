import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildYtDlpArgs,
  classifyYtDlpInfo,
  collectImportAssets,
  enhanceYtDlpError
} from "./instagramImporter";

describe("classifyYtDlpInfo", () => {
  it("classifies jpg metadata as image", () => {
    expect(classifyYtDlpInfo({ ext: "jpg", vcodec: "none" })).toBe("image");
  });

  it("classifies mp4 metadata with a video codec as video", () => {
    expect(classifyYtDlpInfo({ ext: "mp4", vcodec: "h264" })).toBe("video");
  });

  it("classifies playlist entries as carousel", () => {
    expect(classifyYtDlpInfo({ entries: [{ id: "a" }, { id: "b" }] })).toBe("carousel");
  });
});

describe("collectImportAssets", () => {
  it("returns one image asset per carousel photo", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "carousel-assets-"));
    const importDir = join(dataDir, "imports", "carousel");

    try {
      await mkdir(importDir, { recursive: true });
      await Promise.all([
        writeFile(join(importDir, "media-001.jpg"), "photo-one"),
        writeFile(join(importDir, "media-001.info.json"), "{}"),
        writeFile(join(importDir, "media-002.jpg"), "photo-two"),
        writeFile(join(importDir, "media-002.info.json"), "{}"),
        writeFile(join(importDir, "media-003.jpg"), "photo-three"),
        writeFile(join(importDir, "media-003.info.json"), "{}"),
        writeFile(join(importDir, "media-004.jpg"), "photo-four"),
        writeFile(join(importDir, "media-004.info.json"), "{}")
      ]);

      const assets = await collectImportAssets(importDir, dataDir, "/media");

      expect(assets).toHaveLength(4);
      expect(assets.map((asset) => asset.mediaType)).toEqual(["image", "image", "image", "image"]);
      expect(assets.map((asset) => asset.files.image)).toEqual([
        "/media/imports/carousel/media-001.jpg",
        "/media/imports/carousel/media-002.jpg",
        "/media/imports/carousel/media-003.jpg",
        "/media/imports/carousel/media-004.jpg"
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe("buildYtDlpArgs", () => {
  it("ignores user config, suppresses update checks, and uses Chrome cookies by default", () => {
    const args = buildYtDlpArgs("/tmp/media-%(autonumber)03d.%(ext)s", "https://www.instagram.com/p/example/");

    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-update");
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("chrome");
  });

  it("can disable browser cookies for diagnostics", () => {
    const args = buildYtDlpArgs(
      "/tmp/media-%(autonumber)03d.%(ext)s",
      "https://www.instagram.com/p/example/",
      "none"
    );

    expect(args).not.toContain("--cookies-from-browser");
  });
});

describe("enhanceYtDlpError", () => {
  it("adds a clear Chrome login instruction for Instagram login-required errors", () => {
    const message = enhanceYtDlpError(
      "Requested content is not available, rate-limit reached or login required"
    );

    expect(message).toContain("Instagram requires authenticated browser cookies.");
    expect(message).toContain("Google Chrome");
  });
});
