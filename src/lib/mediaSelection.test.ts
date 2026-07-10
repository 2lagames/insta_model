import { describe, expect, it } from "vitest";
import { toggleMediaSelection } from "./mediaSelection";

describe("toggleMediaSelection", () => {
  it("adds and removes media ids without losing other selected items", () => {
    expect(toggleMediaSelection(["image-1"], "image-2")).toEqual(["image-1", "image-2"]);
    expect(toggleMediaSelection(["image-1", "image-2"], "image-1")).toEqual(["image-2"]);
  });
});
