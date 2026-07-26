import { describe, expect, it } from "vitest";
import { formatGenerationSnapshotEvent } from "./generationEvents";

describe("formatGenerationSnapshotEvent", () => {
  it("formats a queue snapshot for EventSource clients", () => {
    const text = formatGenerationSnapshotEvent([]);
    expect(text).toContain("event: generation-snapshot");
    expect(text).toContain("data: {\"jobs\":[]}");
    expect(text.endsWith("\n\n")).toBe(true);
  });
});
