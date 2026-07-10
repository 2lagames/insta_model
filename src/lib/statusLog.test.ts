import { describe, expect, it } from "vitest";
import { createStatusLogText } from "./statusLog";

describe("createStatusLogText", () => {
  it("includes the status label and message for clipboard output", () => {
    expect(createStatusLogText("error", "ScrapeCreators request failed")).toBe(
      "Status: error\n\nScrapeCreators request failed"
    );
  });
});
