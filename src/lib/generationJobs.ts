import type { ImportItem } from "./importTypes";
import type { RunningHubWorkflowPreset } from "./generationPresets";
import type { RunningHubGenerationJobInput } from "./runningHubJobs";

export type GenerationJobKind = "image" | "video";
export type GenerationJobMoveDirection = "up" | "down";
export type GenerationJobStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "submitting"
  | "running"
  | "downloading"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled"
  | "recovery_required";

export type GenerationJobErrorPhase =
  | "prepare"
  | "upload"
  | "submit"
  | "poll"
  | "download"
  | "persist"
  | "cancel"
  | "recovery";

export type GenerationJobError = {
  phase: GenerationJobErrorPhase;
  code: string;
  message: string;
  retryable: boolean;
  details?: string;
};

export type GenerationJobInput = {
  workflowPresetId: string;
  workflow: RunningHubWorkflowPreset;
  job: RunningHubGenerationJobInput;
};

export type GenerationJob = {
  id: string;
  idempotencyKey: string;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  input: GenerationJobInput;
  providerTaskId?: string;
  attempt: number;
  output?: ImportItem;
  error?: GenerationJobError;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type GenerationJobSnapshot = {
  schemaVersion: 1;
  jobs: GenerationJob[];
};

const statuses: GenerationJobStatus[] = [
  "queued", "preparing", "uploading", "submitting", "running", "downloading",
  "canceling", "succeeded", "failed", "canceled", "recovery_required"
];

const allowedTransitions: Record<GenerationJobStatus, GenerationJobStatus[]> = {
  queued: ["preparing", "canceled"],
  preparing: ["uploading", "running", "queued", "canceling", "failed"],
  uploading: ["submitting", "queued", "canceling", "failed"],
  submitting: ["running", "queued", "canceling", "failed", "recovery_required"],
  running: ["downloading", "queued", "canceling", "failed", "recovery_required"],
  downloading: ["succeeded", "queued", "canceling", "failed", "recovery_required"],
  canceling: ["canceled", "succeeded", "failed"],
  failed: ["queued"],
  recovery_required: ["queued"],
  succeeded: [],
  canceled: []
};

export function assertGenerationJobTransition(from: GenerationJobStatus, to: GenerationJobStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Generation job cannot transition from ${from} to ${to}.`);
  }
}

export function isTerminalGenerationJobStatus(status: GenerationJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function parseGenerationJobSnapshot(value: unknown): GenerationJobSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.jobs)) {
    throw new Error("Invalid generation queue snapshot.");
  }
  for (const job of value.jobs) {
    if (!isGenerationJob(job)) {
      throw new Error("Invalid generation queue job.");
    }
  }
  return value as GenerationJobSnapshot;
}

function isGenerationJob(value: unknown): value is GenerationJob {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.idempotencyKey !== "string") {
    return false;
  }
  if ((value.kind !== "image" && value.kind !== "video") || !statuses.includes(value.status as GenerationJobStatus)) {
    return false;
  }
  return isRecord(value.input)
    && typeof value.input.workflowPresetId === "string"
    && isRecord(value.input.workflow)
    && isRecord(value.input.job)
    && Number.isInteger(value.attempt)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
