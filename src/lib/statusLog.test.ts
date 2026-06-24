import { describe, expect, it } from "vitest";
import { createStatusLogText } from "./statusLog";

describe("createStatusLogText", () => {
  it("includes the status label and message for clipboard output", () => {
    expect(createStatusLogText("error", "yt-dlp exited with code 1")).toBe(
      "Status: error\n\nyt-dlp exited with code 1"
    );
  });
});
