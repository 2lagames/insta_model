export class GenerationCancelledError extends Error {
  constructor() {
    super("Generation cancelled.");
    this.name = "GenerationCancelledError";
  }
}

export type RunningHubTaskReference = {
  apiKey: string;
  taskId: string;
};

type CancelRunningHubTask = (task: RunningHubTaskReference) => Promise<void>;

export class GenerationOperation {
  private readonly abortController = new AbortController();
  private readonly runningHubTasks = new Map<string, RunningHubTaskReference>();

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  registerRunningHubTask(task: RunningHubTaskReference): void {
    this.runningHubTasks.set(task.taskId, task);
  }

  cancel(): RunningHubTaskReference[] {
    this.abortController.abort();
    return [...this.runningHubTasks.values()];
  }

  throwIfCancelled(): void {
    if (this.signal.aborted) {
      throw new GenerationCancelledError();
    }
  }
}

export class GenerationController {
  private activeGeneration: GenerationOperation | undefined;

  constructor(private readonly cancelRunningHubTask: CancelRunningHubTask) {}

  start(): GenerationOperation {
    if (this.activeGeneration) {
      throw new Error("Another generation is already running.");
    }

    const generation = new GenerationOperation();
    this.activeGeneration = generation;
    return generation;
  }

  finish(generation: GenerationOperation): void {
    if (this.activeGeneration === generation) {
      this.activeGeneration = undefined;
    }
  }

  hasActiveGeneration(): boolean {
    return this.activeGeneration !== undefined;
  }

  async cancel(): Promise<boolean> {
    const generation = this.activeGeneration;
    if (!generation) {
      return false;
    }

    const tasks = generation.cancel();
    await Promise.allSettled(tasks.map((task) => this.cancelRunningHubTask(task)));
    return true;
  }
}
