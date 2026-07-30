import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportItem } from "../src/lib/importTypes";
import { GenerationQueueStore } from "./generationQueueStore";
import { GenerationWorker } from "./generationWorker";
import {
  RunningHubDownloadError,
  RunningHubPollUnavailableError,
  RunningHubPollTimeoutError,
  RunningHubTerminalTaskError
} from "./runningHub";

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

    completions.get(jobs[0].id)!.reject(new RunningHubTerminalTaskError("provider canceled", "CANCELED"));
    completions.get(jobs[1].id)!.resolve();
    await worker.whenIdle();

    expect((await queue.get(jobs[0].id))?.status).toBe("canceled");
    expect((await queue.get(jobs[1].id))?.status).toBe("succeeded");
  });

  it("persists a task created during cancellation and cancels it at the provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const [job] = await queue.createJobs("video", [input]);
    const submitting = deferred<void>();
    const allowTaskCreation = deferred<void>();
    const canceledTaskIds: string[] = [];
    let attempts = 0;
    const worker = new GenerationWorker(queue, async (_job, context) => {
      attempts += 1;
      if (attempts > 1) {
        throw new RunningHubTerminalTaskError("provider canceled", "CANCELED");
      }
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      submitting.resolve();
      await allowTaskCreation.promise;
      await context.setTaskId("provider-task-race");
      context.signal.throwIfAborted();
      return output(job.id);
    }, () => undefined, {
      concurrency: 1,
      resumableRetryDelayMs: 0,
      cancelProviderTask: async (current) => {
        canceledTaskIds.push(current.providerTaskId!);
      }
    });

    await worker.start();
    await submitting.promise;
    await worker.cancel(job.id);
    allowTaskCreation.resolve();
    await worker.whenIdle();

    expect(canceledTaskIds).toEqual(["provider-task-race"]);
    expect(await queue.get(job.id)).toMatchObject({
      status: "canceled",
      providerTaskId: "provider-task-race"
    });
  });

  it("holds the slot while cancellation status is temporarily unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const firstSubmitted = deferred<void>();
    const failFirstPoll = deferred<void>();
    const resumedPoll = deferred<void>();
    const confirmTerminal = deferred<void>();
    const starts: string[] = [];
    let firstAttempts = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      if (job.id !== jobs[0].id) {
        await context.setPhase("uploading");
        await context.setPhase("submitting");
        await context.setTaskId("provider-task-2");
        await context.setPhase("downloading");
        return output(job.id);
      }
      firstAttempts += 1;
      if (firstAttempts === 1) {
        await context.setPhase("uploading");
        await context.setPhase("submitting");
        await context.setTaskId("provider-task-1");
        firstSubmitted.resolve();
        await failFirstPoll.promise;
        throw new RunningHubPollUnavailableError("poll unavailable");
      }
      resumedPoll.resolve();
      await confirmTerminal.promise;
      throw new RunningHubTerminalTaskError("provider canceled", "CANCELED");
    }, () => undefined, {
      concurrency: 1,
      resumableRetryDelayMs: 0,
      cancelProviderTask: async () => undefined
    });

    await worker.start();
    await firstSubmitted.promise;
    await worker.cancel(jobs[0].id);
    failFirstPoll.resolve();
    await resumedPoll.promise;

    expect(starts).toEqual([jobs[0].id, jobs[0].id]);
    expect((await queue.get(jobs[0].id))?.status).toBe("canceling");
    expect((await queue.get(jobs[1].id))?.status).toBe("queued");

    confirmTerminal.resolve();
    await worker.whenIdle();
    expect((await queue.list()).map((job) => job.status)).toEqual(["canceled", "succeeded"]);
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

  it("runs a failed RunningHub generation again before ordinary queued work", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const starts: string[] = [];
    const resumedProviderTaskIds: Array<string | undefined> = [];
    let firstAttempts = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      if (job.id === jobs[0].id) {
        firstAttempts += 1;
        resumedProviderTaskIds.push(job.providerTaskId);
      }
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId(`provider-${job.id}-${firstAttempts}`);
      if (job.id === jobs[0].id && firstAttempts === 1) {
        throw new RunningHubTerminalTaskError("provider workflow failed", "工作流运行失败");
      }
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, { concurrency: 1 });

    await worker.start();
    await worker.whenIdle();

    expect(starts).toEqual([jobs[0].id, jobs[0].id, jobs[1].id]);
    expect(resumedProviderTaskIds).toEqual([undefined, undefined]);
    expect(await queue.get(jobs[0].id)).toMatchObject({
      status: "succeeded",
      attempt: 2
    });
  });

  it("stops automatic RunningHub retries after three failed attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const starts: string[] = [];
    let firstAttempts = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      if (job.id === jobs[0].id) {
        firstAttempts += 1;
        await context.setTaskId(`provider-failed-${firstAttempts}`);
        throw new RunningHubTerminalTaskError("工作流运行失败", "工作流运行失败");
      }
      await context.setTaskId("provider-success");
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, { concurrency: 1 });

    await worker.start();
    await worker.whenIdle();

    expect(starts).toEqual([jobs[0].id, jobs[0].id, jobs[0].id, jobs[1].id]);
    expect(await queue.get(jobs[0].id)).toMatchObject({
      status: "failed",
      attempt: 3,
      providerTaskId: "provider-failed-3",
      error: {
        phase: "poll",
        code: "RUNNINGHUB_PROVIDER_FAILED",
        message: "工作流运行失败",
        retryable: false
      }
    });
    expect((await queue.get(jobs[1].id))?.status).toBe("succeeded");
  });

  it("reports scheduler failures instead of leaving a rejected promise unobserved", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const [job] = await queue.createJobs("image", [input]);
    vi.spyOn(queue, "claimNext").mockRejectedValueOnce(new Error("claim failed"));
    const errors: string[] = [];
    const worker = new GenerationWorker(queue, async (current, context) => {
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId("provider-task");
      await context.setPhase("downloading");
      return output(current.id);
    }, () => undefined, {
      schedulerRetryDelayMs: 0,
      onWorkerError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });

    await worker.start();
    await waitFor(() => errors.length === 1);
    await waitFor(() => errors.length === 1 && errors[0] === "claim failed");
    await worker.whenIdle();
    expect(errors).toEqual(["claim failed"]);
    expect((await queue.get(job.id))?.status).toBe("succeeded");
  });

  it("reports persistence failures raised while completing an execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const [job] = await queue.createJobs("image", [input]);
    vi.spyOn(queue, "fail").mockRejectedValueOnce(new Error("persist failed"));
    const errors: Array<{ jobId?: string; message: string }> = [];
    const worker = new GenerationWorker(queue, async () => {
      throw new Error("provider failed");
    }, () => undefined, {
      onWorkerError: (error, currentJob) => {
        errors.push({
          jobId: currentJob?.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    await worker.start();
    await worker.whenIdle();

    expect(errors).toEqual([{ jobId: job.id, message: "persist failed" }]);
  });

  it("holds the slot while a new provider task id is temporarily not persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const originalRecordTaskId = queue.recordProviderTaskId.bind(queue);
    const allowPersistence = deferred<void>();
    const persistenceFailed = deferred<void>();
    let recordAttempts = 0;
    vi.spyOn(queue, "recordProviderTaskId").mockImplementation(async (jobId, taskId) => {
      recordAttempts += 1;
      if (recordAttempts === 1) throw new Error("task id persistence failed");
      await allowPersistence.promise;
      return await originalRecordTaskId(jobId, taskId);
    });
    const starts: string[] = [];
    const canceledTaskIds: string[] = [];
    let firstJobExecutions = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      if (job.id === jobs[0].id) {
        firstJobExecutions += 1;
        if (firstJobExecutions > 1) {
          throw new RunningHubTerminalTaskError("provider canceled", "CANCELED");
        }
      }
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId(`provider-${job.id}`);
      context.signal.throwIfAborted();
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, {
      concurrency: 1,
      resumableRetryDelayMs: 10,
      cancelProviderTask: async (job) => {
        canceledTaskIds.push(job.providerTaskId!);
      },
      onWorkerError: (error) => {
        if (error instanceof Error && error.message === "task id persistence failed") {
          persistenceFailed.resolve();
        }
      }
    });

    await worker.start();
    await persistenceFailed.promise;
    await worker.cancel(jobs[0].id);
    await waitFor(() => canceledTaskIds.length === 1);

    expect(canceledTaskIds).toEqual([`provider-${jobs[0].id}`]);
    expect(starts).toEqual([jobs[0].id]);
    expect((await queue.get(jobs[1].id))?.status).toBe("queued");

    allowPersistence.resolve();
    await worker.whenIdle();
    expect((await queue.get(jobs[0].id))?.providerTaskId).toBe(`provider-${jobs[0].id}`);
    expect((await queue.get(jobs[0].id))?.status).toBe("canceled");
    expect((await queue.get(jobs[1].id))?.status).toBe("succeeded");
  });

  it.each([
    [
      new RunningHubPollUnavailableError("RunningHub request failed while checking task provider-task-1: fetch failed"),
      "RUNNINGHUB_POLL_UNAVAILABLE"
    ],
    [
      new RunningHubPollTimeoutError("RunningHub task provider-task-1 timed out"),
      "RUNNINGHUB_POLL_TIMEOUT"
    ]
  ])("keeps the slot and resumes automatically after %s", async (executionError) => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    const jobs = await queue.createJobs("video", [input, input]);
    const resumed = deferred<void>();
    const finishResumedPoll = deferred<void>();
    const starts: string[] = [];
    let attempts = 0;
    const worker = new GenerationWorker(queue, async (job, context) => {
      starts.push(job.id);
      if (job.id === jobs[0].id) {
        attempts += 1;
        if (attempts === 1) {
          await context.setPhase("uploading");
          await context.setPhase("submitting");
          await context.setTaskId("provider-task-1");
          throw executionError;
        }
        resumed.resolve();
        await finishResumedPoll.promise;
      } else {
        await context.setPhase("uploading");
        await context.setPhase("submitting");
        await context.setTaskId("provider-task-2");
      }
      await context.setPhase("downloading");
      return output(job.id);
    }, () => undefined, {
      concurrency: 1,
      resumableRetryDelayMs: 0
    });

    await worker.start();
    await resumed.promise;

    expect(starts).toEqual([jobs[0].id, jobs[0].id]);
    expect((await queue.get(jobs[0].id))?.status).toBe("running");
    expect((await queue.get(jobs[1].id))?.status).toBe("queued");

    finishResumedPoll.resolve();
    await worker.whenIdle();
    expect((await queue.list()).map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("marks a download failure as safe to retry with the same provider task", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("video", [input]);
    const worker = new GenerationWorker(queue, async (_job, context) => {
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId("provider-task-1");
      await context.setPhase("downloading");
      throw new RunningHubDownloadError("Could not download provider task output");
    });

    await worker.start();
    await worker.whenIdle();
    const [failed] = await queue.list();
    expect(failed.error?.code).toBe("RUNNINGHUB_DOWNLOAD_FAILED");
    expect(failed.providerTaskId).toBe("provider-task-1");
  });

  it("marks local result persistence failure as safe to retry without a new provider task", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-worker-"));
    tempDirs.push(root);
    const queue = new GenerationQueueStore(root);
    await queue.createJobs("video", [input]);
    const worker = new GenerationWorker(queue, async (_job, context) => {
      await context.setPhase("uploading");
      await context.setPhase("submitting");
      await context.setTaskId("provider-task-1");
      await context.setPhase("downloading");
      throw new Error("local result persistence failed");
    });

    await worker.start();
    await worker.whenIdle();

    const [failed] = await queue.list();
    expect(failed.error).toMatchObject({
      phase: "persist",
      code: "GENERATION_RESULT_PERSIST_FAILED"
    });
    expect((await queue.retry(failed.id)).providerTaskId).toBe("provider-task-1");
  });
});
