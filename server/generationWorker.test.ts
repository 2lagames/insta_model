import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportItem } from "../src/lib/importTypes";
import { GenerationQueueStore } from "./generationQueueStore";
import { GenerationWorker } from "./generationWorker";
import { RunningHubPollUnavailableError } from "./runningHub";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for worker state.");
}

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
  it("runs two jobs concurrently and starts the third when either finishes", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("image", [input, input, input]);
    const releases = new Map(jobs.map((job) => [job.id, deferred<void>()]));
    let active = 0;
    let maximumActive = 0;
    const starts: string[] = [];
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId(`task-${job.id}`);
      await releases.get(job.id)!.promise;
      await context.setPhase("downloading");
      active -= 1;
      return output(job.id);
    }, () => undefined, { concurrency: 2 });

    await worker.start();
    await waitFor(() => starts.length === 2);

    expect(maximumActive).toBe(2);
    expect(starts).toEqual(jobs.slice(0, 2).map((job) => job.id));

    releases.get(jobs[0].id)!.resolve();
    await waitFor(() => starts.length === 3);

    expect(starts).toEqual(jobs.map((job) => job.id));
    releases.get(jobs[1].id)!.resolve();
    releases.get(jobs[2].id)!.resolve();
    await worker.whenIdle();

    const completed = await queue.list();
    expect(maximumActive).toBe(2);
    expect(completed.map((job) => job.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(completed.map((job) => job.output?.id)).toEqual(jobs.map((job) => job.id));
  });

  it("coalesces repeated wake calls without exceeding capacity", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("image", [input, input, input]);
    const gate = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await context.setPhase("uploading");
      await gate.promise;
      await context.setPhase("submitting");
      await context.setTaskId(`task-${job.id}`);
      await context.setPhase("downloading");
      active -= 1;
      return output(job.id);
    }, () => undefined, { concurrency: 2 });

    await worker.start();
    worker.wake();
    worker.wake();
    worker.wake();
    await waitFor(() => active === 2);

    expect(maximumActive).toBe(2);
    gate.resolve();
    await worker.whenIdle();
    expect(maximumActive).toBe(2);
  });

  it("canceling one active job leaves the other signal untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const signals = new Map<string, AbortSignal>();
    const gate = deferred<void>();
    const worker = new GenerationWorker(queue, async (job, context) => {
      signals.set(job.id, context.signal);
      await context.setPhase("uploading");
      await new Promise<void>((resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new DOMException("Generation cancelled.", "AbortError")), { once: true });
        void gate.promise.then(resolve);
      });
      await context.setPhase("submitting");
      await context.setTaskId(`task-${job.id}`);
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, { concurrency: 2 });

    await worker.start();
    await waitFor(() => signals.size === 2);
    await worker.cancel(jobs[0].id);

    expect(signals.get(jobs[0].id)?.aborted).toBe(true);
    expect(signals.get(jobs[1].id)?.aborted).toBe(false);
    gate.resolve();
    await worker.whenIdle();

    expect((await queue.get(jobs[0].id))?.status).toBe("canceled");
    expect((await queue.get(jobs[1].id))?.status).toBe("succeeded");
  });

  it("keeps a provider task in its slot until cancellation is resolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const completions = new Map(jobs.map((job) => [job.id, deferred<void>()]));
    const signals = new Map<string, AbortSignal>();
    const submitted = new Set<string>();
    const canceledTaskIds: string[] = [];
    const worker = new GenerationWorker(queue, async (job, context) => {
      signals.set(job.id, context.signal);
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId(`task-${job.id}`);
      submitted.add(job.id);
      await completions.get(job.id)!.promise;
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, {
      concurrency: 2,
      cancelProviderTask: async (job) => {
        canceledTaskIds.push(job.providerTaskId!);
      }
    });

    await worker.start();
    await waitFor(() => jobs.every((job) => signals.has(job.id)));
    await waitFor(() => submitted.size === 2);
    await worker.cancel(jobs[0].id);

    expect(canceledTaskIds).toEqual([`task-${jobs[0].id}`]);
    expect(signals.get(jobs[0].id)?.aborted).toBe(false);
    expect(signals.get(jobs[1].id)?.aborted).toBe(false);
    expect((await queue.get(jobs[0].id))?.status).toBe("canceling");

    completions.get(jobs[0].id)!.reject(new Error("provider canceled"));
    completions.get(jobs[1].id)!.resolve();
    await worker.whenIdle();

    expect((await queue.get(jobs[0].id))?.status).toBe("canceled");
    expect((await queue.get(jobs[1].id))?.status).toBe("succeeded");
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

  it("marks an exhausted RunningHub polling outage as safe to resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("video", [input]);
    const worker = new GenerationWorker(queue, async (_job, context) => {
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId("provider-task-1");
      throw new RunningHubPollUnavailableError("RunningHub request failed while checking task provider-task-1: fetch failed");
    });

    await worker.start();
    await worker.whenIdle();

    const [failed] = await queue.list();
    expect(failed.error?.code).toBe("RUNNINGHUB_POLL_UNAVAILABLE");
    expect(failed.providerTaskId).toBe("provider-task-1");
  });
});
