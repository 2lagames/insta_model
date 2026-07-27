import type { GenerationJob, GenerationJobStatus } from "./generationJobs";
import type { PromptMediaInput } from "./promptTypes";

export type GenerationQueueFilter = "active" | "failed" | "completed" | "all";
export type GenerationStatusTone = "waiting" | "running" | "success" | "error" | "muted";
export type GenerationJobRecipe = {
  visualInputs: Array<{
    id: string;
    label: string;
    previewPath?: string;
  }>;
  promptInputs: Array<{
    kind: "image" | "video";
    label: string;
  }>;
  resultLabel: "Изображение" | "Видео";
};

const statusPresentation: Record<GenerationJobStatus, { label: string; tone: GenerationStatusTone }> = {
  queued: { label: "В очереди", tone: "waiting" },
  preparing: { label: "Подготовка", tone: "running" },
  uploading: { label: "Загрузка входов", tone: "running" },
  submitting: { label: "Запуск в RunningHub", tone: "running" },
  running: { label: "Генерация", tone: "running" },
  downloading: { label: "Скачивание", tone: "running" },
  canceling: { label: "Отмена…", tone: "waiting" },
  succeeded: { label: "Готово", tone: "success" },
  failed: { label: "Ошибка", tone: "error" },
  canceled: { label: "Отменено", tone: "muted" },
  recovery_required: { label: "Требуется проверка", tone: "error" }
};

const executingStatuses = new Set<GenerationJobStatus>([
  "preparing", "uploading", "submitting", "running", "downloading", "canceling"
]);

export function getGenerationStatusPresentation(status: GenerationJobStatus) {
  return statusPresentation[status];
}

export function filterGenerationJobs(jobs: GenerationJob[], filter: GenerationQueueFilter): GenerationJob[] {
  if (filter === "active") {
    return jobs.filter((job) => !["succeeded", "failed", "canceled"].includes(job.status));
  }
  if (filter === "failed") {
    return jobs.filter((job) => job.status === "failed" || job.status === "recovery_required");
  }
  if (filter === "completed") {
    return jobs.filter((job) => job.status === "succeeded" || job.status === "canceled");
  }
  return jobs;
}

export function summarizeGenerationJobs(jobs: GenerationJob[]) {
  return {
    active: filterGenerationJobs(jobs, "active").length,
    executing: jobs.filter((job) => executingStatuses.has(job.status)).length,
    queued: jobs.filter((job) => job.status === "queued").length,
    failed: filterGenerationJobs(jobs, "failed").length,
    completed: filterGenerationJobs(jobs, "completed").length
  };
}

export function getNewGenerationOutputIds(jobs: GenerationJob[], observedIds: ReadonlySet<string>): string[] {
  return jobs.flatMap((job) => (
    job.status === "succeeded" && job.output && !observedIds.has(job.output.id)
      ? [job.output.id]
      : []
  ));
}

export function getGenerationJobMoveAvailability(
  jobs: GenerationJob[],
  jobId: string
): { canMoveUp: boolean; canMoveDown: boolean } {
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const queuedIndex = queuedJobs.findIndex((job) => job.id === jobId);
  return {
    canMoveUp: queuedIndex > 0,
    canMoveDown: queuedIndex >= 0 && queuedIndex < queuedJobs.length - 1
  };
}

export function mergeEnqueuedGenerationJobs(
  current: GenerationJob[],
  enqueued: GenerationJob[]
): GenerationJob[] {
  const existingIds = new Set(current.map((job) => job.id));
  return [
    ...current,
    ...enqueued.filter((job) => !existingIds.has(job.id))
  ];
}

export function getGenerationJobQueuePosition(
  jobs: GenerationJob[],
  jobId: string
): number | undefined {
  const index = jobs.filter((job) => job.status === "queued").findIndex((job) => job.id === jobId);
  return index >= 0 ? index + 1 : undefined;
}

export function createGenerationJobRecipe(job: GenerationJob): GenerationJobRecipe {
  const jobInput = job.input.job;
  const visualInputs = deduplicateVisualInputs([
    jobInput.media,
    jobInput.sourceImage,
    jobInput.generatedImage
  ]);
  const promptInputs: GenerationJobRecipe["promptInputs"] = [];

  if (jobInput.imagePrompt) {
    promptInputs.push({ kind: "image", label: jobInput.imagePrompt.mediaLabel });
  }
  if (jobInput.videoPrompt) {
    promptInputs.push({ kind: "video", label: jobInput.videoPrompt.mediaLabel });
  }

  if (promptInputs.length === 0 && jobInput.prompt?.trim()) {
    const studioIds = new Set(job.input.workflow.bindings.map((binding) => binding.studioId));
    if (studioIds.has("2")) {
      promptInputs.push({ kind: "image", label: jobInput.media.label });
    }
    if (studioIds.has("5")) {
      promptInputs.push({ kind: "video", label: jobInput.media.label });
    }
  }

  return {
    visualInputs,
    promptInputs,
    resultLabel: job.kind === "image" ? "Изображение" : "Видео"
  };
}

function deduplicateVisualInputs(
  mediaInputs: Array<PromptMediaInput | undefined>
): GenerationJobRecipe["visualInputs"] {
  const seen = new Set<string>();
  return mediaInputs.flatMap((media) => {
    if (!media || seen.has(media.id)) {
      return [];
    }
    seen.add(media.id);
    return [{
      id: media.id,
      label: media.label,
      previewPath: media.imagePath
    }];
  });
}
