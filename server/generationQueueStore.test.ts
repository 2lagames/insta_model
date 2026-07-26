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
  it("claims at most one job while another job is active", async () => {
    const store = await createStore();
    await store.createJobs("image", [input, input]);

    const [first, second] = await Promise.all([store.claimNext(), store.claimNext()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await store.list()).filter((job) => job.status === "preparing")).toHaveLength(1);
  });

  it("recovers safe local phases and flags ambiguous submission", async () => {
    const store = await createStore();
    const [preparing, submitting] = await store.createJobs("image", [input, input]);
    await store.transition(preparing.id, "preparing");
    await store.transition(submitting.id, "preparing");
    await store.transition(submitting.id, "uploading");
    await store.transition(submitting.id, "submitting");

    await store.recover();

    expect((await store.get(preparing.id))?.status).toBe("queued");
    expect((await store.get(submitting.id))?.status).toBe("recovery_required");
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
