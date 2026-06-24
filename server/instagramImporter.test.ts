import { describe, expect, it } from "vitest";
import { classifyYtDlpInfo } from "./instagramImporter";

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
