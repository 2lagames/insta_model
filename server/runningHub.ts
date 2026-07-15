import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ImportAsset, ImportItem } from "../src/lib/importTypes";

type FetchLike = typeof fetch;
type StatusCallback = (event: { tone: "running" | "ready" | "error"; message: string; source: "runninghub" }) => void;

const defaultRunningHubBaseUrl = process.env.RUNNINGHUB_API_BASE_URL ?? "https://www.runninghub.cn";
const defaultPollIntervalMs = Number(process.env.RUNNINGHUB_POLL_INTERVAL_MS ?? 5_000);
const defaultMaxPolls = Number(process.env.RUNNINGHUB_MAX_POLLS ?? 180);
const defaultOutputMaxPolls = Number(process.env.RUNNINGHUB_OUTPUT_MAX_POLLS ?? 12);

export type RunningHubConfig = {
  apiKey: string;
  workflowId: string;
  promptNodeId: string;
  promptFieldName: string;
  imageNodeId: string;
  imageFieldName: string;
};

export type RunningHubPromptJob = {
  mediaId: string;
  label: string;
  imagePath: string;
  prompt: string;
};

export type RunningHubCreatePayload = {
  apiKey: string;
  workflowId: string;
  instanceType: "plus";
  nodeInfoList: Array<{
    nodeId: string;
    fieldName: string;
    fieldValue: string;
  }>;
};

export type RunningHubGenerationResult = {
  item: ImportItem;
  assets: ImportAsset[];
};

type RunningHubGenerationOptions = {
  outputDir: string;
  config: RunningHubConfig;
  jobs: RunningHubPromptJob[];
  fetchImpl?: FetchLike;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  now?: Date;
  onStatus?: StatusCallback;
  signal?: AbortSignal;
  onTaskCreated?: (taskId: string) => void;
};

export function buildRunningHubCreatePayload(input: {
  apiKey: string;
  workflowId: string;
  promptNodeId: string;
  promptFieldName: string;
  imageNodeId: string;
  imageFieldName: string;
  uploadedImageFileName: string;
  prompt: string;
}): RunningHubCreatePayload {
  return {
    apiKey: input.apiKey,
    workflowId: input.workflowId,
    instanceType: "plus",
    nodeInfoList: [
      {
        nodeId: input.imageNodeId,
        fieldName: input.imageFieldName,
        fieldValue: input.uploadedImageFileName
      },
      {
        nodeId: input.promptNodeId,
        fieldName: input.promptFieldName,
        fieldValue: input.prompt
      }
    ]
  };
}

export async function runRunningHubImageGeneration(options: RunningHubGenerationOptions): Promise<RunningHubGenerationResult> {
  assertRunningHubConfig(options.config);

  if (options.jobs.length === 0) {
    throw new Error("RunningHub generation requires at least one prompt job.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? defaultRunningHubBaseUrl;
  const now = options.now ?? new Date();
  const dateFolder = formatDateFolder(now);
  const outputDateDir = join(options.outputDir, dateFolder);
  const allAssets: ImportAsset[] = [];
  const taskIds: string[] = [];

  await mkdir(outputDateDir, { recursive: true });

  for (const [jobIndex, job] of options.jobs.entries()) {
    throwIfAborted(options.signal);
    const passLabel = `${job.label} (${jobIndex + 1}/${options.jobs.length})`;
    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `Uploading source image for ${passLabel}.`
    });

    let uploadedImageFileName: string;
    try {
      uploadedImageFileName = await uploadRunningHubImage({
        apiKey: options.config.apiKey,
        imagePath: job.imagePath,
        fetchImpl,
        baseUrl,
        signal: options.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Could not upload source image for ${job.label}: ${message}`);
    }

    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `Creating RunningHub Plus task for ${passLabel}.`
    });

    const taskId = await createTask({
      baseUrl,
      fetchImpl,
      config: options.config,
      prompt: job.prompt,
      uploadedImageFileName,
      signal: options.signal
    });
    taskIds.push(taskId);
    options.onTaskCreated?.(taskId);
    throwIfAborted(options.signal);

    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `RunningHub task ${taskId} created for ${passLabel}. Waiting for completion.`
    });
    await waitForTaskCompletion({
      apiKey: options.config.apiKey,
      baseUrl,
      fetchImpl,
      taskId,
      pollIntervalMs: options.pollIntervalMs ?? defaultPollIntervalMs,
      maxPolls: options.maxPolls ?? defaultMaxPolls,
      onStatus: options.onStatus,
      signal: options.signal
    });

    const imageUrls = await waitForTaskOutputs({
      apiKey: options.config.apiKey,
      baseUrl,
      fetchImpl,
      taskId,
      pollIntervalMs: options.pollIntervalMs ?? defaultPollIntervalMs,
      maxPolls: options.maxPolls ?? defaultOutputMaxPolls,
      onStatus: options.onStatus,
      signal: options.signal
    });

    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `Downloading ${imageUrls.length} RunningHub image(s) for ${passLabel}.`
    });
    const savedAssets = await Promise.all(imageUrls.map((url, outputIndex) => downloadOutputImage({
      fetchImpl,
      outputDateDir,
      dateFolder,
      taskId,
      sourceMediaId: job.mediaId,
      url,
      outputIndex,
      signal: options.signal
    })));
    allAssets.push(...savedAssets);
  }

  const itemId = `runninghub-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ImportItem = {
    id: itemId,
    sourceUrl: `runninghub://${taskIds.join(",")}`,
    mediaType: allAssets.length === 1 ? "image" : "carousel",
    status: "ready",
    createdAt: now.toISOString(),
    title: `RunningHub generation (${allAssets.length} images)`,
    caption: `Generated ${allAssets.length} image(s) from ${options.jobs.length} selected media item(s).`,
    provider: "runninghub",
    files: allAssets[0]?.files ?? {},
    assets: allAssets
  };

  options.onStatus?.({
    tone: "ready",
    source: "runninghub",
    message: `RunningHub generation complete: ${allAssets.length} image(s) saved to output/${dateFolder}.`
  });

  return { item, assets: allAssets };
}

function assertRunningHubConfig(config: RunningHubConfig): void {
  if (!config.apiKey.trim()) {
    throw new Error("Add RunningHub API key on the Подключения tab before image generation.");
  }
  if (!config.workflowId.trim()) {
    throw new Error("Add RunningHub workflow ID on the Подключения tab before image generation.");
  }
  if (!config.promptNodeId.trim()) {
    throw new Error("Add RunningHub prompt node ID on the Подключения tab before image generation.");
  }
  if (!config.promptFieldName.trim()) {
    throw new Error("Add RunningHub prompt field name on the Подключения tab before image generation.");
  }
  if (!config.imageNodeId.trim()) {
    throw new Error("Add RunningHub image node ID on the Подключения tab before image generation.");
  }
  if (!config.imageFieldName.trim()) {
    throw new Error("Add RunningHub image field name on the Подключения tab before image generation.");
  }
}

async function createTask(options: {
  baseUrl: string;
  fetchImpl: FetchLike;
  config: RunningHubConfig;
  prompt: string;
  uploadedImageFileName: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await postRunningHub(options.fetchImpl, new URL("/task/openapi/create", options.baseUrl), buildRunningHubCreatePayload({
    apiKey: options.config.apiKey,
    workflowId: options.config.workflowId,
    promptNodeId: options.config.promptNodeId,
    promptFieldName: options.config.promptFieldName,
    imageNodeId: options.config.imageNodeId,
    imageFieldName: options.config.imageFieldName,
    uploadedImageFileName: options.uploadedImageFileName,
    prompt: options.prompt
  }), "creating task", options.signal);
  const payload = await response.json() as unknown;
  assertRunningHubOk(payload, "create task");
  const taskId = extractTaskId(payload);
  if (!taskId) {
    throw new Error(`RunningHub create task response did not include a taskId: ${JSON.stringify(payload)}`);
  }
  return taskId;
}

export async function uploadRunningHubImage(options: {
  apiKey: string;
  imagePath: string;
  fetchImpl: FetchLike;
  baseUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.set("apiKey", options.apiKey);
  form.set("file", new Blob([await readFile(options.imagePath)]), basename(options.imagePath));

  const response = await postRunningHubForm(
    options.fetchImpl,
    new URL("/task/openapi/upload", options.baseUrl),
    form,
    "uploading source image",
    options.signal
  );
  const payload = await response.json() as unknown;
  assertRunningHubOk(payload, "upload source image");
  const fileName = extractUploadedFileName(payload);
  if (!fileName) {
    throw new Error(`RunningHub upload source image response did not include data.fileName: ${JSON.stringify(payload)}`);
  }
  return fileName;
}

async function waitForTaskCompletion(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  taskId: string;
  pollIntervalMs: number;
  maxPolls: number;
  onStatus?: StatusCallback;
  signal?: AbortSignal;
}): Promise<void> {
  for (let attempt = 1; attempt <= options.maxPolls; attempt += 1) {
    throwIfAborted(options.signal);
    const response = await postRunningHub(options.fetchImpl, new URL("/task/openapi/status", options.baseUrl), {
      apiKey: options.apiKey,
      taskId: options.taskId
    }, `checking task ${options.taskId}`, options.signal);
    const payload = await response.json() as unknown;
    assertRunningHubOk(payload, `check task ${options.taskId}`);
    const status = extractStatus(payload);

    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `RunningHub task ${options.taskId}: ${status || "status unknown"} (${attempt}/${options.maxPolls}).`
    });

    if (isSuccessStatus(status)) {
      return;
    }
    if (isFailureStatus(status)) {
      throw new Error(`RunningHub task ${options.taskId} failed with status: ${status}`);
    }
    await sleep(options.pollIntervalMs, options.signal);
  }

  throw new Error(`RunningHub task ${options.taskId} did not finish after ${options.maxPolls} status checks.`);
}

async function fetchTaskOutputs(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  taskId: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const response = await postRunningHub(options.fetchImpl, new URL("/task/openapi/outputs", options.baseUrl), {
    apiKey: options.apiKey,
    taskId: options.taskId
  }, `loading task ${options.taskId} outputs`, options.signal);
  const payload = await response.json() as unknown;
  assertRunningHubOk(payload, `load task ${options.taskId} outputs`);
  return extractImageUrls(payload);
}

async function waitForTaskOutputs(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  taskId: string;
  pollIntervalMs: number;
  maxPolls: number;
  onStatus?: StatusCallback;
  signal?: AbortSignal;
}): Promise<string[]> {
  let lastCount = 0;

  for (let attempt = 1; attempt <= options.maxPolls; attempt += 1) {
    throwIfAborted(options.signal);
    const urls = await fetchTaskOutputs({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      taskId: options.taskId,
      signal: options.signal
    });
    lastCount = urls.length;

    if (urls.length > 0) {
      return urls;
    }

    options.onStatus?.({
      tone: "running",
      source: "runninghub",
      message: `RunningHub task ${options.taskId}: outputs are not ready yet (0 images, ${attempt}/${options.maxPolls}).`
    });
    await sleep(options.pollIntervalMs, options.signal);
  }

  throw new Error(`RunningHub task ${options.taskId} outputs were not ready after ${options.maxPolls} checks (${lastCount} image URLs found).`);
}

async function postRunningHub(fetchImpl: FetchLike, url: URL, body: unknown, action: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, withSignal({
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, signal));
  } catch (error) {
    throwIfAborted(signal);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`RunningHub request failed while ${action}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`RunningHub request failed while ${action} with ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function postRunningHubForm(fetchImpl: FetchLike, url: URL, form: FormData, action: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, withSignal({
      method: "POST",
      body: form
    }, signal));
  } catch (error) {
    throwIfAborted(signal);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`RunningHub request failed while ${action}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`RunningHub request failed while ${action} with ${response.status}: ${await response.text()}`);
  }
  return response;
}

function assertRunningHubOk(payload: unknown, action: string): void {
  if (!payload || typeof payload !== "object") {
    throw new Error(`RunningHub ${action} returned an invalid response.`);
  }

  const record = payload as Record<string, unknown>;
  if (record.error) {
    const code = record.code === undefined ? "" : ` ${String(record.code)}`;
    throw new Error(`RunningHub ${action} failed${code}: ${String(record.error)}`);
  }
  if (typeof record.code === "number" && record.code !== 0 && record.code !== 200) {
    throw new Error(`RunningHub ${action} failed with code ${record.code}: ${String(record.msg ?? record.message ?? JSON.stringify(payload))}`);
  }
  if (record.success === false) {
    throw new Error(`RunningHub ${action} failed: ${JSON.stringify(payload)}`);
  }
}

function extractTaskId(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (typeof data === "string" && data.trim()) {
      return data;
    }
  }
  const candidates = collectStringFields(payload, ["taskId", "task_id", "id"]);
  return candidates[0];
}

function extractUploadedFileName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const fileName = (data as Record<string, unknown>).fileName;
  return typeof fileName === "string" && fileName.trim() ? fileName : undefined;
}

function extractStatus(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (typeof data === "string" && data.trim()) {
      return data;
    }
  }
  return collectStringFields(payload, ["status", "taskStatus", "state"])[0];
}

function extractImageUrls(payload: unknown): string[] {
  const urls = collectStringFields(payload, ["fileUrl", "file_url", "imageUrl", "image_url", "url", "downloadUrl", "download_url"]);
  return urls.filter((url) => /^https?:\/\//i.test(url));
}

function collectStringFields(value: unknown, fieldNames: string[]): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringFields(item, fieldNames));
  }
  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = fieldNames
    .map((fieldName) => record[fieldName])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const nested = Object.values(record).flatMap((item) => collectStringFields(item, fieldNames));
  return [...direct, ...nested];
}

async function downloadOutputImage(options: {
  fetchImpl: FetchLike;
  outputDateDir: string;
  dateFolder: string;
  taskId: string;
  sourceMediaId: string;
  url: string;
  outputIndex: number;
  signal?: AbortSignal;
}): Promise<ImportAsset> {
  throwIfAborted(options.signal);
  const response = options.signal
    ? await options.fetchImpl(options.url, { signal: options.signal })
    : await options.fetchImpl(options.url);
  if (!response.ok) {
    throw new Error(`Could not download RunningHub output ${options.url}: ${response.status} ${await response.text()}`);
  }

  const extension = getOutputExtension(options.url, response.headers.get("Content-Type"));
  const fileName = `${sanitizeFilePart(options.taskId)}-image-${options.outputIndex + 1}${extension}`;
  const absolutePath = join(options.outputDateDir, fileName);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(absolutePath, bytes);

  return {
    id: `${sanitizeFilePart(options.sourceMediaId)}-output-${options.outputIndex + 1}-${sanitizeFilePart(options.taskId)}`,
    mediaType: "image",
    files: {
      image: `/output/${options.dateFolder}/${fileName}`,
      thumbnail: `/output/${options.dateFolder}/${fileName}`
    }
  };
}

function getOutputExtension(url: string, contentType: string | null): string {
  const pathExtension = extname(new URL(url).pathname);
  if (pathExtension && pathExtension.length <= 6) {
    return pathExtension;
  }
  if (contentType?.includes("jpeg")) {
    return ".jpg";
  }
  if (contentType?.includes("webp")) {
    return ".webp";
  }
  return ".png";
}

function sanitizeFilePart(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runninghub";
}

function isSuccessStatus(status: string | undefined): boolean {
  return Boolean(status && ["success", "succeeded", "complete", "completed", "finished"].includes(status.toLowerCase()));
}

function isFailureStatus(status: string | undefined): boolean {
  return Boolean(status && ["fail", "failed", "error", "canceled", "cancelled"].includes(status.toLowerCase()));
}

function formatDateFolder(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export async function cancelRunningHubTask(options: {
  apiKey: string;
  taskId: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): Promise<void> {
  const response = await postRunningHub(
    options.fetchImpl ?? fetch,
    new URL("/task/openapi/cancel", options.baseUrl ?? defaultRunningHubBaseUrl),
    { apiKey: options.apiKey, taskId: options.taskId },
    `cancelling task ${options.taskId}`
  );
  assertRunningHubOk(await response.json() as unknown, `cancel task ${options.taskId}`);
}

function withSignal(init: RequestInit, signal: AbortSignal | undefined): RequestInit {
  return signal ? { ...init, signal } : init;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Generation cancelled.", "AbortError");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Generation cancelled.", "AbortError"));
    }, { once: true });
  });
}
