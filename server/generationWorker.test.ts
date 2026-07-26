import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportItem } from "../src/lib/importTypes";
import { GenerationQueueStore } from "./generationQueueStore";
import { GenerationWorker } from "./generationWorker";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const input = {
  workflowPresetId: "workflow",
  workflow: {
    id: "workflow",
    displayId: "RH01",
    workflowId: "provider-workflow",
    instanceType: "standard" as const,
    bindings: []
  },
  job: { media: { id: "media", label: "Media", imagePath: "/input/media.png", sourceKind: "photo" as const }, prompt: "Prompt" }
};

function output(id: string): ImportItem {
  return {
    id,
    sourceUrl: `runninghub://${id}`,
    mediaType: "image",
    status: "ready",
    createdAt: new Date().toISOString(),
    files: { image: `/output/${id}.png` },
    assets: [{ id, mediaType: "image", files: { image: `/output/${id}.png` } }]
  };
}

describe("GenerationWorker", () => {
  it("executes queued jobs one at a time and preserves independent results", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("image", [input, input]);
    let active = 0;
    let maximumActive = 0;
    let call = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      call += 1;
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId(`task-${call}`);
      await context.setPhase("downloading");
      active -= 1;
      return output(job.id);
    });

    await worker.start();
    await worker.whenIdle();

    const jobs = await queue.list();
    expect(maximumActive).toBe(1);
    expect(jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
    expect(jobs.map((job) => job.output?.id)).toEqual(jobs.map((job) => job.id));
  });

  it("continues with the next job after an independent failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("video", [input, input]);
    let call = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      call += 1;
      if (call === 1) throw new Error("provider failed");
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId("task-2");
      await context.setPhase("downloading");
      return output(job.id);
    });

    await worker.start();
    await worker.whenIdle();

    expect((await queue.list()).map((job) => job.status)).toEqual(["failed", "succeeded"]);
  });
});
