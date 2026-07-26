import { describe, expect, it } from "vitest";
import {
  assertGenerationJobTransition,
  isTerminalGenerationJobStatus,
  parseGenerationJobSnapshot
} from "./generationJobs";

describe("generation job state", () => {
  it("allows the normal queue execution transitions", () => {
    expect(() => assertGenerationJobTransition("queued", "preparing")).not.toThrow();
    expect(() => assertGenerationJobTransition("submitting", "running")).not.toThrow();
    expect(() => assertGenerationJobTransition("downloading", "succeeded")).not.toThrow();
  });

  it("rejects skipping directly from queued to succeeded", () => {
    expect(() => assertGenerationJobTransition("queued", "succeeded"))
      .toThrow("queued");
  });

  it("identifies only completed states as terminal", () => {
    expect(isTerminalGenerationJobStatus("succeeded")).toBe(true);
    expect(isTerminalGenerationJobStatus("failed")).toBe(true);
    expect(isTerminalGenerationJobStatus("canceled")).toBe(true);
    expect(isTerminalGenerationJobStatus("recovery_required")).toBe(false);
  });

  it("parses a valid empty queue snapshot", () => {
    expect(parseGenerationJobSnapshot({ schemaVersion: 1, jobs: [] })).toEqual({
      schemaVersion: 1,
      jobs: []
    });
  });

  it("rejects malformed persisted jobs", () => {
    expect(() => parseGenerationJobSnapshot({
      schemaVersion: 1,
      jobs: [{ id: "job-1", status: "mystery" }]
    })).toThrow("generation queue");
  });
});
