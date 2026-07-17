import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveImportMetadataPath } from "./localMetadata";

describe("resolveImportMetadataPath", () => {
  it("resolves the allowlisted Apify photo manifest for a normal import id", () => {
    expect(resolveImportMetadataPath("/project/data", "20260715-abc123")).toBe(
      resolve("/project/data/imports/20260715-abc123/apify-photos.json")
    );
  });

  it.each(["", ".", "..", "../connections.local.json", "item/../../private"])(
    "rejects an unsafe import id: %s",
    (importId) => {
      expect(resolveImportMetadataPath("/project/data", importId)).toBeUndefined();
    }
  );
});
