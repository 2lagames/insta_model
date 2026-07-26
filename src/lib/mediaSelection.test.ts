import { describe, expect, it } from "vitest";
import { toggleAllMediaSelection, toggleExclusiveMediaSelection, toggleMediaSelection } from "./mediaSelection";

describe("toggleMediaSelection", () => {
  it("adds and removes media ids without losing other selected items", () => {
    expect(toggleMediaSelection(["image-1"], "image-2")).toEqual(["image-1", "image-2"]);
    expect(toggleMediaSelection(["image-1", "image-2"], "image-1")).toEqual(["image-2"]);
  });
});

describe("toggleExclusiveMediaSelection", () => {
  it("replaces a linked first frame with its video while keeping unrelated selections", () => {
    const materials = [
      { id: "frame", selectionGroupId: "source-1" },
      { id: "video", selectionGroupId: "source-1" },
      { id: "other", selectionGroupId: "source-2" }
    ];
    expect(toggleExclusiveMediaSelection(["frame", "other"], "video", materials))
      .toEqual(["other", "video"]);
  });
});

describe("toggleAllMediaSelection", () => {
  it("selects every material until all are selected, then clears the selection", () => {
    const materialIds = ["image-1", "image-2", "image-3"];

    expect(toggleAllMediaSelection(["image-1"], materialIds)).toEqual(materialIds);
    expect(toggleAllMediaSelection(materialIds, materialIds)).toEqual([]);
  });
});
