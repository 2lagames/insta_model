import { describe, expect, it } from "vitest";
import { formatSseEvent } from "./activityLog";

describe("formatSseEvent", () => {
  it("formats activity events for EventSource clients", () => {
    const text = formatSseEvent({
      id: "1",
      tone: "running",
      message: "Ollama: downloading digest 25%",
      createdAt: "2026-06-25T09:00:00.000Z",
      source: "ollama"
    });

    expect(text).toContain("event: activity");
    expect(text).toContain("\"message\":\"Ollama: downloading digest 25%\"");
    expect(text.endsWith("\n\n")).toBe(true);
  });
});
