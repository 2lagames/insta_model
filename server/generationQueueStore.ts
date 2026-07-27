import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  assertGenerationJobTransition,
  isTerminalGenerationJobStatus,
  parseGenerationJobSnapshot,
  type GenerationJob,
  type GenerationJobError,
  type GenerationJobInput,
  type GenerationJobKind,
  type GenerationJobMoveDirection,
  type GenerationJobSnapshot,
  type GenerationJobStatus
} from "../src/lib/generationJobs";
import type { ImportItem } from "../src/lib/importTypes";
import { JsonStateStore } from "./jsonStateStore";

const activeStatuses = new Set<GenerationJobStatus>([
  "preparing", "uploading", "submitting", "running", "downloading", "canceling"
]);

export class GenerationQueueStore {
  private readonly state: JsonStateStore<GenerationJobSnapshot>;

  constructor(rootDir: string) {
    this.state = new JsonStateStore(
      join(rootDir, "generation", "queue.json"),
      () => ({ schemaVersion: 1, jobs: [] }),
      parseGenerationJobSnapshot
    );
  }

  async list(): Promise<GenerationJob[]> {
    return (await this.state.read()).jobs;
  }

  async get(id: string): Promise<GenerationJob | undefined> {
    return (await this.list()).find((job) => job.id === id);
  }

  async createJobs(kind: GenerationJobKind, inputs: GenerationJobInput[]): Promise<GenerationJob[]> {
    if (inputs.length === 0) throw new Error("At least one generation job is required.");
    const now = new Date().toISOString();
    const jobs = inputs.map((input): GenerationJob => ({
      id: randomUUID(),
      idempotencyKey: randomUUID(),
      kind,
      status: "queued",
      input: structuredClone(input),
      attempt: 1,
      createdAt: now,
      updatedAt: now
    }));
    await this.state.mutate((snapshot) => ({
      ...snapshot,
      jobs: [...snapshot.jobs, ...jobs]
    }));
    return jobs;
  }

  async claimNext(concurrency = 1): Promise<GenerationJob | undefined> {
    let claimed: GenerationJob | undefined;
    await this.state.mutate((snapshot) => {
      const activeCount = snapshot.jobs.filter((job) => activeStatuses.has(job.status)).length;
      if (activeCount >= concurrency) return snapshot;
      const index = snapshot.jobs.findIndex((job) => job.status === "queued");
      if (index < 0) return snapshot;
      const jobs = [...snapshot.jobs];
      claimed = updateStatus(jobs[index], "preparing", { startedAt: jobs[index].startedAt ?? new Date().toISOString() });
      jobs[index] = claimed;
      return { ...snapshot, jobs };
    });
    return claimed;
  }

  async transition(
    id: string,
    status: GenerationJobStatus,
    update: Partial<Pick<GenerationJob, "providerTaskId" | "output" | "error" | "cancelRequestedAt" | "startedAt" | "completedAt">> = {}
  ): Promise<GenerationJob> {
    let result: GenerationJob | undefined;
    await this.state.mutate((snapshot) => ({
      ...snapshot,
      jobs: snapshot.jobs.map((job) => {
        if (job.id !== id) return job;
        result = updateStatus(job, status, update);
        return result;
      })
    }));
    if (!result) throw new Error(`Generation job ${id} was not found.`);
    return result;
  }

  async fail(id: string, error: GenerationJobError): Promise<GenerationJob> {
    return await this.transition(id, "failed", { error, completedAt: new Date().toISOString() });
  }

  async succeed(id: string, output: ImportItem): Promise<GenerationJob> {
    return await this.transition(id, "succeeded", { output, completedAt: new Date().toISOString() });
  }

  async requestCancel(id: string): Promise<GenerationJob> {
    const job = await this.getRequired(id);
    if (job.status === "queued") {
      return await this.transition(id, "canceled", { completedAt: new Date().toISOString() });
    }
    if (activeStatuses.has(job.status) && job.status !== "canceling") {
      return await this.transition(id, "canceling", { cancelRequestedAt: new Date().toISOString() });
    }
    return job;
  }

  async moveQueued(id: string, direction: GenerationJobMoveDirection): Promise<GenerationJob[]> {
    let result: GenerationJob[] = [];
    await this.state.mutate((snapshot) => {
      const index = snapshot.jobs.findIndex((job) => job.id === id);
      if (index < 0) throw new Error(`Generation job ${id} was not found.`);
      if (snapshot.jobs[index].status !== "queued") {
        throw new Error("Only queued generation jobs can be moved.");
      }

      const queuedIndexes = snapshot.jobs.flatMap((job, jobIndex) => (
        job.status === "queued" ? [jobIndex] : []
      ));
      const queuedIndex = queuedIndexes.indexOf(index);
      const targetQueuedIndex = direction === "up" ? queuedIndex - 1 : queuedIndex + 1;
      if (targetQueuedIndex < 0 || targetQueuedIndex >= queuedIndexes.length) {
        result = snapshot.jobs;
        return snapshot;
      }

      const targetIndex = queuedIndexes[targetQueuedIndex];
      const jobs = [...snapshot.jobs];
      [jobs[index], jobs[targetIndex]] = [jobs[targetIndex], jobs[index]];
      result = jobs;
      return { ...snapshot, jobs };
    });
    return result;
  }

  async retry(id: string, options: { confirmAmbiguous?: boolean } = {}): Promise<GenerationJob> {
    const job = await this.getRequired(id);
    if (job.status === "recovery_required" && options.confirmAmbiguous !== true) {
      throw new Error("Retry confirmation is required because RunningHub may already have created this task.");
    }
    if (job.status !== "failed" && job.status !== "recovery_required") {
      throw new Error(`Generation job ${id} cannot be retried from ${job.status}.`);
    }
    let result: GenerationJob | undefined;
    await this.state.mutate((snapshot) => ({
      ...snapshot,
      jobs: snapshot.jobs.map((item) => {
        if (item.id !== id) return item;
        assertGenerationJobTransition(item.status, "queued");
        const pollingRequestFailed = item.error?.phase === "poll"
          && item.error.message.startsWith(`RunningHub request failed while checking task ${item.providerTaskId}:`);
        const resumeProviderTask = Boolean(item.providerTaskId)
          && (item.error?.code === "RUNNINGHUB_POLL_UNAVAILABLE" || pollingRequestFailed);
        result = {
          ...item,
          status: "queued",
          attempt: item.attempt + 1,
          providerTaskId: resumeProviderTask ? item.providerTaskId : undefined,
          output: undefined,
          error: undefined,
          cancelRequestedAt: undefined,
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: new Date().toISOString()
        };
        return result;
      })
    }));
    return result!;
  }

  async recover(): Promise<GenerationJob[]> {
    const recovered: GenerationJob[] = [];
    await this.state.mutate((snapshot) => ({
      ...snapshot,
      jobs: snapshot.jobs.map((job) => {
        let next = job;
        if (job.status === "preparing" || job.status === "uploading") {
          next = updateStatus(job, "queued");
        } else if (job.status === "submitting" || job.status === "running" || job.status === "downloading") {
          next = job.providerTaskId
            ? updateStatus(job, "queued")
            : updateStatus(job, "recovery_required", {
              error: {
                phase: "recovery",
                code: "AMBIGUOUS_SUBMISSION",
                message: "RunningHub may already have created this task.",
                retryable: false
              }
            });
        }
        if (next !== job) recovered.push(next);
        return next;
      })
    }));
    return recovered;
  }

  private async getRequired(id: string): Promise<GenerationJob> {
    const job = await this.get(id);
    if (!job) throw new Error(`Generation job ${id} was not found.`);
    return job;
  }
}

function updateStatus(
  job: GenerationJob,
  status: GenerationJobStatus,
  update: Partial<GenerationJob> = {}
): GenerationJob {
  assertGenerationJobTransition(job.status, status);
  return {
    ...job,
    ...update,
    status,
    updatedAt: new Date().toISOString(),
    ...(isTerminalGenerationJobStatus(status) && !update.completedAt
      ? { completedAt: new Date().toISOString() }
      : {})
  };
}
