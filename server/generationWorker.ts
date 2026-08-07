import type { GenerationJob, GenerationJobStatus } from "../src/lib/generationJobs";
import type { ImportItem } from "../src/lib/importTypes";
import type { GenerationConcurrency } from "./generationConcurrency";
import { GenerationQueueStore } from "./generationQueueStore";
import {
  RunningHubDownloadError,
  RunningHubPollUnavailableError,
  RunningHubPollTimeoutError,
  RunningHubTerminalTaskError
} from "./runningHub";

type WorkerPhase = Extract<GenerationJobStatus, "uploading" | "submitting" | "downloading">;

export type GenerationExecutionContext = {
  signal: AbortSignal;
  setPhase: (phase: WorkerPhase) => Promise<void>;
  setTaskId: (taskId: string) => Promise<void>;
};

export type GenerationJobExecutor = (
  job: GenerationJob,
  context: GenerationExecutionContext
) => Promise<ImportItem>;

export type GenerationWorkerOptions = {
  concurrency?: GenerationConcurrency;
  cancelProviderTask?: (job: GenerationJob) => Promise<void>;
  onCancelError?: (job: GenerationJob, error: unknown) => void;
  onWorkerError?: (error: unknown, job?: GenerationJob) => void;
  resumableRetryDelayMs?: number;
  schedulerRetryDelayMs?: number;
};

type ActiveExecution = {
  abortController: AbortController;
  promise: Promise<void>;
};

const cancellableStatuses = new Set<GenerationJobStatus>([
  "queued", "preparing", "uploading", "submitting", "running", "downloading", "canceling"
]);

export class GenerationWorker {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly concurrency: GenerationConcurrency;
  private schedulePromise: Promise<void> | undefined;
  private scheduleRequested = false;
  private schedulerFailureCount = 0;

  constructor(
    private readonly queue: GenerationQueueStore,
    private readonly execute: GenerationJobExecutor,
    private readonly onChange: () => void = () => undefined,
    private readonly options: GenerationWorkerOptions = {}
  ) {
    this.concurrency = options.concurrency ?? 1;
  }

  async start(): Promise<void> {
    await this.queue.recover();
    this.wake();
  }

  wake(): void {
    this.scheduleRequested = true;
    if (!this.schedulePromise) {
      this.schedulePromise = this.schedule()
        .then(() => {
          this.schedulerFailureCount = 0;
        })
        .catch(async (error) => {
          this.reportWorkerError(error);
          this.schedulerFailureCount += 1;
          const baseDelay = this.options.schedulerRetryDelayMs ?? 1_000;
          const delay = Math.min(baseDelay * (2 ** (this.schedulerFailureCount - 1)), 30_000);
          await waitForRetry(delay);
          this.scheduleRequested = true;
        })
        .finally(() => {
          this.schedulePromise = undefined;
          if (this.scheduleRequested) this.wake();
        });
    }
  }

  async whenIdle(): Promise<void> {
    while (true) {
      this.wake();
      if (this.schedulePromise) await this.schedulePromise;
      const activePromises = [...this.active.values()].map((execution) => execution.promise);
      if (activePromises.length === 0) {
        if (!this.schedulePromise && this.active.size === 0) return;
        continue;
      }
      await Promise.allSettled(activePromises);
    }
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.queue.requestCancel(jobId);
    const activeExecution = this.active.get(jobId);
    if (job.status !== "canceling") {
      this.onChange();
      return job;
    }

    const canceled = await this.queue.transition(jobId, "canceled", { completedAt: new Date().toISOString() });
    activeExecution?.abortController.abort();
    this.onChange();
    if (job.providerTaskId) await this.requestProviderCancellation(job);
    return canceled;
  }

  async cancelAll(): Promise<GenerationJob[]> {
    const jobs = (await this.queue.list()).filter((job) => cancellableStatuses.has(job.status));
    const results = await Promise.allSettled(jobs.map((job) => this.cancel(job.id)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    return results.map((result) => (result as PromiseFulfilledResult<GenerationJob>).value);
  }

  private async schedule(): Promise<void> {
    while (this.scheduleRequested) {
      this.scheduleRequested = false;
      while (this.active.size < this.concurrency) {
        const job = await this.queue.claimNext(this.concurrency);
        if (!job) break;
        this.launch(job);
        this.onChange();
      }
    }
  }

  private launch(job: GenerationJob): void {
    const execution: ActiveExecution = {
      abortController: new AbortController(),
      promise: Promise.resolve()
    };
    this.active.set(job.id, execution);
    execution.promise = this.executeOne(job, execution)
      .catch((error) => this.reportWorkerError(error, job))
      .finally(() => {
        this.active.delete(job.id);
        this.onChange();
        this.wake();
      });
  }

  private async executeOne(job: GenerationJob, execution: ActiveExecution): Promise<void> {
    let executingJob = job;
    let cancellationRequestedTaskId: string | undefined;
    while (true) {
      try {
        if (executingJob.status === "preparing" && executingJob.providerTaskId) {
          executingJob = await this.queue.transition(
            job.id,
            executingJob.cancelRequestedAt ? "canceling" : "running"
          );
          if (executingJob.cancelRequestedAt) {
            executingJob = await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
            execution.abortController.abort();
            this.onChange();
            await this.requestProviderCancellation(executingJob);
            return;
          }
          this.onChange();
        }
        const output = await this.execute(executingJob, {
          signal: execution.abortController.signal,
          setPhase: async (phase) => {
            const current = await this.queue.get(job.id);
            if (current?.status === "canceling") {
              executingJob = current;
              return;
            }
            executingJob = await this.queue.transition(job.id, phase);
            this.onChange();
          },
          setTaskId: async (taskId) => {
            while (true) {
              try {
                const current = await this.queue.get(job.id);
                if ((current?.status === "canceling" || current?.status === "canceled")
                  && cancellationRequestedTaskId !== taskId) {
                  cancellationRequestedTaskId = taskId;
                  await this.requestProviderCancellation({ ...current, providerTaskId: taskId });
                }
                executingJob = await this.queue.recordProviderTaskId(job.id, taskId);
                if (executingJob.status === "canceling" || executingJob.status === "canceled") {
                  if (executingJob.status === "canceling") {
                    executingJob = await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
                  }
                  this.onChange();
                  if (cancellationRequestedTaskId !== taskId) {
                    cancellationRequestedTaskId = taskId;
                    await this.requestProviderCancellation(executingJob);
                  }
                  return;
                }
                this.onChange();
                return;
              } catch (error) {
                const current = await this.queue.get(job.id).catch(() => undefined);
                const pendingJob = current
                  ? { ...current, providerTaskId: taskId }
                  : { ...executingJob, providerTaskId: taskId };
                this.reportWorkerError(error, pendingJob);
                if ((pendingJob.status === "canceling" || pendingJob.status === "canceled")
                  && cancellationRequestedTaskId !== taskId) {
                  cancellationRequestedTaskId = taskId;
                  await this.requestProviderCancellation(pendingJob);
                }
                await waitForRetry(this.options.resumableRetryDelayMs ?? 5_000);
              }
            }
          }
        });
        const current = await this.queue.get(job.id);
        if (current?.status === "canceled") return;
        await this.queue.succeed(job.id, output);
        return;
      } catch (error) {
        const current = await this.queue.get(job.id);
        if (!current) throw error;
        if (current.status === "canceled") return;
        const message = error instanceof Error ? error.message : "Generation failed.";
        if (error instanceof RunningHubTerminalTaskError) {
          await this.queue.resolveProviderFailure(job.id, {
            phase: "poll",
            code: "RUNNINGHUB_PROVIDER_FAILED",
            message,
            retryable: false
          }, 3);
          this.onChange();
          return;
        }
        if (current.status === "canceling") {
          await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
          return;
        }
        if (current.status === "running" && current.providerTaskId) {
          this.reportWorkerError(error, current);
          executingJob = current;
          await waitForRetry(this.options.resumableRetryDelayMs ?? 5_000);
          continue;
        }
        if (execution.abortController.signal.aborted) {
          await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
          return;
        }
        const failure = generationFailure(error, current.status);
        await this.queue.fail(job.id, {
          phase: failure.phase,
          code: failure.code,
          message,
          retryable: true
        });
        return;
      }
    }
  }

  private async requestProviderCancellation(job: GenerationJob): Promise<void> {
    if (!this.options.cancelProviderTask) return;
    try {
      await this.options.cancelProviderTask(job);
    } catch (error) {
      this.options.onCancelError?.(job, error);
    }
  }

  private reportWorkerError(error: unknown, job?: GenerationJob): void {
    try {
      this.options.onWorkerError?.(error, job);
    } catch {
      // Error reporting must not create another unobserved worker rejection.
    }
  }
}

function phaseForStatus(status: GenerationJobStatus | undefined) {
  if (status === "uploading") return "upload" as const;
  if (status === "submitting") return "submit" as const;
  if (status === "running") return "poll" as const;
  if (status === "downloading") return "download" as const;
  if (status === "canceling") return "cancel" as const;
  return "prepare" as const;
}

async function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function generationFailure(error: unknown, status: GenerationJobStatus) {
  if (error instanceof RunningHubPollUnavailableError) {
    return { phase: "poll" as const, code: "RUNNINGHUB_POLL_UNAVAILABLE" };
  }
  if (error instanceof RunningHubPollTimeoutError) {
    return { phase: "poll" as const, code: "RUNNINGHUB_POLL_TIMEOUT" };
  }
  if (error instanceof RunningHubDownloadError) {
    return { phase: "download" as const, code: "RUNNINGHUB_DOWNLOAD_FAILED" };
  }
  if (status === "downloading") {
    return { phase: "persist" as const, code: "GENERATION_RESULT_PERSIST_FAILED" };
  }
  return { phase: phaseForStatus(status), code: "GENERATION_FAILED" };
}
