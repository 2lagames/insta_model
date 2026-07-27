import type { GenerationJob, GenerationJobStatus } from "../src/lib/generationJobs";
import type { ImportItem } from "../src/lib/importTypes";
import type { GenerationConcurrency } from "./generationConcurrency";
import { GenerationQueueStore } from "./generationQueueStore";
import { RunningHubPollUnavailableError } from "./runningHub";

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
};

type ActiveExecution = {
  abortController: AbortController;
  promise: Promise<void>;
};

export class GenerationWorker {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly concurrency: GenerationConcurrency;
  private schedulePromise: Promise<void> | undefined;
  private scheduleRequested = false;

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
      this.schedulePromise = this.schedule().finally(() => {
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
    if (activeExecution) {
      if (job.providerTaskId) {
        await this.requestProviderCancellation(job);
      } else {
        activeExecution.abortController.abort();
      }
    }
    this.onChange();
    return job;
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
    const abortController = new AbortController();
    const execution: ActiveExecution = {
      abortController,
      promise: Promise.resolve()
    };
    this.active.set(job.id, execution);
    execution.promise = this.executeOne(job, abortController).finally(() => {
      this.active.delete(job.id);
      this.onChange();
      this.wake();
    });
  }

  private async executeOne(job: GenerationJob, abortController: AbortController): Promise<void> {
    let executingJob = job;
    try {
      if (job.providerTaskId) {
        executingJob = await this.queue.transition(
          job.id,
          job.cancelRequestedAt ? "canceling" : "running"
        );
        if (job.cancelRequestedAt) {
          await this.requestProviderCancellation(executingJob);
        }
        this.onChange();
      }
      const output = await this.execute(executingJob, {
        signal: abortController.signal,
        setPhase: async (phase) => {
          const current = await this.queue.get(job.id);
          if (current?.status === "canceling") return;
          await this.queue.transition(job.id, phase);
          this.onChange();
        },
        setTaskId: async (taskId) => {
          await this.queue.transition(job.id, "running", { providerTaskId: taskId });
          this.onChange();
        }
      });
      await this.queue.succeed(job.id, output);
    } catch (error) {
      const current = await this.queue.get(job.id);
      const message = error instanceof Error ? error.message : "Generation failed.";
      if (current?.status === "canceling" || abortController.signal.aborted) {
        await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
      } else {
        await this.queue.fail(job.id, {
          phase: phaseForStatus(current?.status),
          code: error instanceof RunningHubPollUnavailableError
            ? "RUNNINGHUB_POLL_UNAVAILABLE"
            : "GENERATION_FAILED",
          message,
          retryable: true
        });
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
}

function phaseForStatus(status: GenerationJobStatus | undefined) {
  if (status === "uploading") return "upload" as const;
  if (status === "submitting") return "submit" as const;
  if (status === "running") return "poll" as const;
  if (status === "downloading") return "download" as const;
  if (status === "canceling") return "cancel" as const;
  return "prepare" as const;
}
