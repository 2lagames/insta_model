import type { GenerationJob, GenerationJobStatus } from "./generationJobs";

export type GenerationQueueFilter = "active" | "failed" | "completed" | "all";
export type GenerationStatusTone = "waiting" | "running" | "success" | "error" | "muted";

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
