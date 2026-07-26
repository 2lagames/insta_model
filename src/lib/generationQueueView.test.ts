import { describe, expect, it } from "vitest";
import type { GenerationJob, GenerationJobStatus } from "./generationJobs";
import {
  filterGenerationJobs,
  getGenerationStatusPresentation,
  getNewGenerationOutputIds,
  summarizeGenerationJobs
} from "./generationQueueView";

function job(status: GenerationJobStatus, outputId?: string): GenerationJob {
  return {
    id: `${status}-${outputId ?? "none"}`,
    idempotencyKey: `${status}-key`,
    kind: "image",
    status,
    input: {
      workflowPresetId: "workflow",
      workflow: {
        id: "workflow",
        displayId: "RH01",
        workflowId: "provider-workflow",
        instanceType: "standard",
        bindings: []
      },
      job: {
        media: {
          id: "media",
          label: "IMAGE 1",
          imagePath: "/input/image.jpg",
          sourceKind: "photo"
        }
      }
    },
    attempt: 1,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...(outputId ? {
      output: {
        id: outputId,
        sourceUrl: `runninghub://${outputId}`,
        mediaType: "image",
        status: "ready",
        createdAt: "2026-07-27T00:01:00.000Z",
        files: { image: `/output/${outputId}.png` },
        assets: []
      }
    } : {})
  };
}

describe("generation queue presentation", () => {
  it("uses readable localized labels and groups completed work", () => {
    expect(getGenerationStatusPresentation("downloading")).toEqual({
      label: "Скачивание",
      tone: "running"
    });
    expect(filterGenerationJobs([job("running"), job("succeeded"), job("failed")], "completed"))
      .toHaveLength(1);
  });

  it("summarizes actionable queue states", () => {
    expect(summarizeGenerationJobs([
      job("running"),
      job("queued"),
      job("failed"),
      job("succeeded")
    ])).toEqual({ active: 2, failed: 1, completed: 1 });
  });

  it("detects each newly completed output exactly once", () => {
    const observed = new Set(["output-1"]);
    expect(getNewGenerationOutputIds([
      job("succeeded", "output-1"),
      job("succeeded", "output-2"),
      job("running")
    ], observed)).toEqual(["output-2"]);
  });
});
