import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationQueueStore } from "./generationQueueStore";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "generation-queue-"));
  tempDirs.push(root);
  return new GenerationQueueStore(root);
}

const input = {
  workflowPresetId: "workflow-1",
  workflow: {
    id: "workflow-1",
    displayId: "RH01",
    workflowId: "provider-workflow",
    instanceType: "standard" as const,
    bindings: []
  },
  job: {
    media: { id: "media-1", label: "Image 1", imagePath: "/input/image.png", sourceKind: "photo" as const },
    prompt: "Portrait"
  }
};

describe("GenerationQueueStore", () => {
  it("claims two jobs atomically and holds the third at concurrency two", async () => {
    const store = await createStore();
    await store.createJobs("image", [input, input, input]);

    const claimed = await Promise.all([
      store.claimNext(2),
      store.claimNext(2),
      store.claimNext(2)
    ]);

    const claimedJobs = claimed.filter((job) => job !== undefined);
    expect(claimedJobs).toHaveLength(2);
    expect(new Set(claimedJobs.map((job) => job.id)).size).toBe(2);
    expect((await store.list()).filter((job) => job.status === "queued")).toHaveLength(1);
  });

  it("recovers safe local phases and flags ambiguous submission", async () => {
    const store = await createStore();
    const [preparing, submitting, submittedWithTask] = await store.createJobs("image", [input, input, input]);
    await store.transition(preparing.id, "preparing");
    await store.transition(submitting.id, "preparing");
    await store.transition(submitting.id, "uploading");
    await store.transition(submitting.id, "submitting");
    await store.transition(submittedWithTask.id, "preparing");
    await store.transition(submittedWithTask.id, "uploading");
    await store.transition(submittedWithTask.id, "submitting", { providerTaskId: "submitted-task" });

    await store.recover();

    expect((await store.get(preparing.id))?.status).toBe("queued");
    expect((await store.get(submitting.id))?.status).toBe("recovery_required");
    expect(await store.get(submittedWithTask.id)).toMatchObject({
      status: "queued",
      providerTaskId: "submitted-task"
    });
  });

  it("resumes two persisted provider tasks without replacing their task ids", async () => {
    const store = await createStore();
    const [running, downloading] = await store.createJobs("video", [input, input]);
    for (const job of [running, downloading]) {
      await store.transition(job.id, "preparing");
      await store.transition(job.id, "uploading");
      await store.transition(job.id, "submitting");
      await store.transition(job.id, "running", { providerTaskId: `task-${job.id}` });
    }
    await store.transition(downloading.id, "downloading");

    await store.recover();

    expect(await store.get(running.id)).toMatchObject({
      status: "queued",
      providerTaskId: `task-${running.id}`
    });
    expect(await store.get(downloading.id)).toMatchObject({
      status: "queued",
      providerTaskId: `task-${downloading.id}`
    });
  });

  it("recovers cancellation intent without releasing a known provider task", async () => {
    const store = await createStore();
    const [providerTask, localTask] = await store.createJobs("video", [input, input]);
    for (const job of [providerTask, localTask]) {
      await store.transition(job.id, "preparing");
      await store.transition(job.id, "uploading");
    }
    await store.transition(providerTask.id, "submitting");
    await store.transition(providerTask.id, "running", { providerTaskId: "provider-task" });
    await store.requestCancel(providerTask.id);
    await store.requestCancel(localTask.id);

    await store.recover();

    expect(await store.get(providerTask.id)).toMatchObject({
      status: "queued",
      providerTaskId: "provider-task",
      cancelRequestedAt: expect.any(String)
    });
    expect((await store.get(localTask.id))?.status).toBe("canceled");
  });

  it("requires confirmation before retrying an ambiguous submission", async () => {
    const store = await createStore();
    const [job] = await store.createJobs("video", [input]);
    await store.transition(job.id, "preparing");
    await store.transition(job.id, "uploading");
    await store.transition(job.id, "submitting");
    await store.recover();

    await expect(store.retry(job.id)).rejects.toThrow("confirmation");
    expect((await store.retry(job.id, { confirmAmbiguous: true })).status).toBe("queued");
  });

  it("resumes the same provider task after polling lost its network connection", async () => {
    const store = await createStore();
    const [job] = await store.createJobs("video", [input]);
    await store.transition(job.id, "preparing");
    await store.transition(job.id, "uploading");
    await store.transition(job.id, "submitting");
    await store.transition(job.id, "running", { providerTaskId: "provider-task-1" });
    await store.fail(job.id, {
      phase: "poll",
      code: "GENERATION_FAILED",
      message: "RunningHub request failed while checking task provider-task-1: fetch failed",
      retryable: true
    });

    const retried = await store.retry(job.id);

    expect(retried.status).toBe("queued");
    expect(retried.providerTaskId).toBe("provider-task-1");
  });

  it("cancels a queued job without claiming it", async () => {
    const store = await createStore();
    const [job] = await store.createJobs("image", [input]);

    expect((await store.requestCancel(job.id)).status).toBe("canceled");
    expect(await store.claimNext()).toBeUndefined();
  });

  it("moves only queued jobs and preserves their order after reopening the store", async () => {
    const root = await mkdtemp(join(tmpdir(), "generation-queue-order-"));
    tempDirs.push(root);
    const store = new GenerationQueueStore(root);
    const [active, firstQueued, secondQueued] = await store.createJobs("image", [input, input, input]);
    await store.transition(active.id, "preparing");

    await store.moveQueued(secondQueued.id, "up");

    expect((await new GenerationQueueStore(root).list()).map((job) => job.id)).toEqual([
      active.id,
      secondQueued.id,
      firstQueued.id
    ]);
    await expect(store.moveQueued(active.id, "down")).rejects.toThrow(/only queued/i);
  });
});
