import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelGenerationJob, enqueueImageJobs, listGenerationJobs, moveGenerationJob, retryGenerationJob } from "./api";

const queuedJob = {
  id: "job-1",
  idempotencyKey: "key-1",
  kind: "image",
  status: "queued",
  input: {},
  attempt: 1,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z"
};

describe("generation queue API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("enqueues image jobs without waiting for provider output", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ jobs: [queuedJob] }),
      { status: 202 }
    ));
    const input = {
      media: { id: "media", label: "Image", imagePath: "/input/image.png", sourceKind: "photo" as const },
      prompt: "Prompt"
    };

    await expect(enqueueImageJobs([input], "workflow")).resolves.toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/generation-jobs/image", expect.objectContaining({ method: "POST" }));
  });

  it("lists, cancels, and explicitly retries jobs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [queuedJob] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: queuedJob })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: queuedJob })));

    await expect(listGenerationJobs()).resolves.toHaveLength(1);
    await cancelGenerationJob("job-1");
    await retryGenerationJob("job-1", true);

    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/generation-jobs/job-1/cancel", { method: "POST" });
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/generation-jobs/job-1/retry", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirmAmbiguous: true })
    }));
  });

  it("moves a queued job in the persistent queue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ jobs: [queuedJob] })
    ));

    await expect(moveGenerationJob("job-1", "up")).resolves.toHaveLength(1);

    expect(fetchSpy).toHaveBeenCalledWith("/api/generation-jobs/job-1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "up" })
    });
  });
});
