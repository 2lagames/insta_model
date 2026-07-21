import { describe, expect, it } from "vitest";
import { assertUniqueRunningHubBindings, validateRunningHubBindings } from "./studioBindings";

describe("assertUniqueRunningHubBindings", () => {
  it("rejects two Studio IDs configured for the same workflow node field", () => {
    expect(() => assertUniqueRunningHubBindings([
      { nodeId: "39", fieldName: "image", studioId: "1" },
      { nodeId: "39", fieldName: "image", studioId: "4" }
    ])).toThrow("Node 39 field image is configured more than once");
  });
});

describe("validateRunningHubBindings", () => {
  it("accepts a dedicated video prompt binding", () => {
    expect(validateRunningHubBindings([
      { nodeId: "6", fieldName: "video_prompt", studioId: "5" }
    ])).toEqual([{ nodeId: "6", fieldName: "video_prompt", studioId: "5" }]);
  });

  it("rejects an incomplete binding instead of silently discarding it", () => {
    expect(() => validateRunningHubBindings([
      { nodeId: "39", fieldName: "", studioId: "1" }
    ])).toThrow("Each workflow binding must include Node ID, Field, and Studio ID");
  });
});
