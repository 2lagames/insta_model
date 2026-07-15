import { describe, expect, it } from "vitest";
import { toggleAllMediaSelection, toggleMediaSelection } from "./mediaSelection";

describe("toggleMediaSelection", () => {
  it("adds and removes media ids without losing other selected items", () => {
    expect(toggleMediaSelection(["image-1"], "image-2")).toEqual(["image-1", "image-2"]);
    expect(toggleMediaSelection(["image-1", "image-2"], "image-1")).toEqual(["image-2"]);
  });
});

describe("toggleAllMediaSelection", () => {
  it("selects every material until all are selected, then clears the selection", () => {
    const materialIds = ["image-1", "image-2", "image-3"];

    expect(toggleAllMediaSelection(["image-1"], materialIds)).toEqual(materialIds);
    expect(toggleAllMediaSelection(materialIds, materialIds)).toEqual([]);
  });
});
