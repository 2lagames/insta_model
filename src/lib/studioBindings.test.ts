import { describe, expect, it } from "vitest";
import { assertUniqueRunningHubBindings } from "./studioBindings";

describe("assertUniqueRunningHubBindings", () => {
  it("rejects two Studio IDs configured for the same workflow node field", () => {
    expect(() => assertUniqueRunningHubBindings([
      { nodeId: "39", fieldName: "image", studioId: "1" },
      { nodeId: "39", fieldName: "image", studioId: "4" }
    ])).toThrow("Node 39 field image is configured more than once");
  });
});
