import { describe, expect, it } from "vitest";
import type { GenerationJob, GenerationJobStatus } from "./generationJobs";
import {
  createGenerationJobRecipe,
  filterGenerationJobs,
  getGenerationJobMoveAvailability,
  getGenerationJobQueuePosition,
  getGenerationStatusPresentation,
  getNewGenerationOutputIds,
  mergeEnqueuedGenerationJobs,
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

  it("allows queued jobs to move only within the queued portion of the list", () => {
    const running = job("running");
    const firstQueued = job("queued");
    firstQueued.id = "queued-1";
    const secondQueued = job("queued");
    secondQueued.id = "queued-2";
    const jobs = [running, firstQueued, job("succeeded"), secondQueued];

    expect(getGenerationJobMoveAvailability(jobs, running.id)).toEqual({
      canMoveUp: false,
      canMoveDown: false
    });
    expect(getGenerationJobMoveAvailability(jobs, firstQueued.id)).toEqual({
      canMoveUp: false,
      canMoveDown: true
    });
    expect(getGenerationJobMoveAvailability(jobs, secondQueued.id)).toEqual({
      canMoveUp: true,
      canMoveDown: false
    });
  });

  it("does not duplicate a job when its live snapshot arrives before the enqueue response", () => {
    const queued = job("queued");
    queued.id = "queued-1";

    expect(mergeEnqueuedGenerationJobs([queued], [queued])).toEqual([queued]);
  });

  it("returns one-based positions only for queued jobs", () => {
    const running = job("running");
    const firstQueued = job("queued");
    firstQueued.id = "queued-1";
    const completed = job("succeeded");
    const secondQueued = job("queued");
    secondQueued.id = "queued-2";
    const jobs = [running, firstQueued, completed, secondQueued];

    expect(getGenerationJobQueuePosition(jobs, running.id)).toBeUndefined();
    expect(getGenerationJobQueuePosition(jobs, firstQueued.id)).toBe(1);
    expect(getGenerationJobQueuePosition(jobs, secondQueued.id)).toBe(2);
  });

  it("describes video generation from frozen visual and prompt inputs", () => {
    const videoJob = job("running");
    videoJob.kind = "video";
    videoJob.input.job = {
      media: {
        id: "reel-1",
        label: "REEL 1",
        imagePath: "/input/reel-1-frame.jpg",
        videoPath: "/input/reel-1.mp4",
        sourceKind: "video-first-frame"
      },
      generatedImage: {
        id: "image-2",
        label: "IMAGE 2",
        imagePath: "/output/image-2.jpg",
        generatedImagePath: "/output/image-2.jpg",
        sourceKind: "photo"
      },
      imagePrompt: {
        mediaId: "image-2",
        mediaLabel: "IMAGE 2",
        text: "Preserve the appearance"
      },
      videoPrompt: {
        mediaId: "reel-1",
        mediaLabel: "REEL 1",
        text: "Animate the movement"
      }
    };

    expect(createGenerationJobRecipe(videoJob)).toEqual({
      visualInputs: [
        { id: "reel-1", label: "REEL 1", previewPath: "/input/reel-1-frame.jpg" },
        { id: "image-2", label: "IMAGE 2", previewPath: "/output/image-2.jpg" }
      ],
      promptInputs: [
        { kind: "image", label: "IMAGE 2" },
        { kind: "video", label: "REEL 1" }
      ],
      resultLabel: "Видео"
    });
  });

  it("shows the same media only once when it fills multiple workflow inputs", () => {
    const imageJob = job("queued");
    imageJob.input.job.generatedImage = {
      ...imageJob.input.job.media,
      generatedImagePath: imageJob.input.job.media.imagePath
    };

    expect(createGenerationJobRecipe(imageJob).visualInputs).toEqual([
      { id: "media", label: "IMAGE 1", previewPath: "/input/image.jpg" }
    ]);
  });
});
