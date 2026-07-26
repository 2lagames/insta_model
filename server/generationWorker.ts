import type { GenerationJob, GenerationJobStatus } from "../src/lib/generationJobs";
import type { ImportItem } from "../src/lib/importTypes";
import { GenerationQueueStore } from "./generationQueueStore";

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

export class GenerationWorker {
  private drainPromise: Promise<void> | undefined;
  private active: { jobId: string; abortController: AbortController } | undefined;

  constructor(
    private readonly queue: GenerationQueueStore,
    private readonly execute: GenerationJobExecutor,
    private readonly onChange: () => void = () => undefined
  ) {}

  async start(): Promise<void> {
    await this.queue.recover();
    this.wake();
  }

  wake(): void {
    if (!this.drainPromise) {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = undefined;
      });
    }
  }

  async whenIdle(): Promise<void> {
    while (this.drainPromise) await this.drainPromise;
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.queue.requestCancel(jobId);
    if (this.active?.jobId === jobId) this.active.abortController.abort();
    this.onChange();
    return job;
  }

  private async drain(): Promise<void> {
    while (true) {
      const job = await this.queue.claimNext();
      if (!job) return;
      this.onChange();
      const abortController = new AbortController();
      this.active = { jobId: job.id, abortController };
      try {
        const output = await this.execute(job, {
          signal: abortController.signal,
          setPhase: async (phase) => {
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
        if (current?.status === "canceling" || abortController.signal.aborted) {
          await this.queue.transition(job.id, "canceled", { completedAt: new Date().toISOString() });
        } else {
          await this.queue.fail(job.id, {
            phase: phaseForStatus(current?.status),
            code: "GENERATION_FAILED",
            message: error instanceof Error ? error.message : "Generation failed.",
            retryable: true
          });
        }
      } finally {
        this.active = undefined;
        this.onChange();
      }
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
