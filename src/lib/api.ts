import type { CurrentMediaSession, ImportItem } from "./importTypes";
import type { PromptMediaInput } from "./promptTypes";
import type { RunningHubBinding } from "./studioBindings";

type ImportsResponse = {
  items: ImportItem[];
  session?: CurrentMediaSession;
  sessionItemIds?: string[];
};

type ImportResponse = {
  item: ImportItem;
  session?: CurrentMediaSession;
  reused?: boolean;
};

type CleanupImportsResponse = {
  items: ImportItem[];
  session?: CurrentMediaSession;
  sessionItemIds?: string[];
  retainedItemIds: string[];
  deletedItemIds: string[];
};

export type ImportsSessionResponse = {
  items: ImportItem[];
  session: CurrentMediaSession;
  sessionItemIds: string[];
};

type ErrorResponse = {
  error?: string;
};

export type GeneratedPrompt = {
  mediaId: string;
  label: string;
  prompt: string;
};

type PromptGenerationResponse = {
  prompts: GeneratedPrompt[];
  session?: CurrentMediaSession;
};

type ImageGenerationResponse = {
  item: ImportItem;
  session?: CurrentMediaSession;
};

export type ImportInstagramResult = {
  item: ImportItem;
  session: CurrentMediaSession;
  reused: boolean;
};

export type CleanupImportsResult = {
  items: ImportItem[];
  session: CurrentMediaSession;
  retainedItemIds: string[];
  deletedItemIds: string[];
};

export type ImageGenerationResult = {
  item: ImportItem;
  session: CurrentMediaSession;
};

export type PromptGenerationResult = {
  prompts: GeneratedPrompt[];
  session: CurrentMediaSession;
};

export type ImageGenerationJobInput = {
  media: PromptMediaInput;
  prompt: string;
};

export type ConnectionKeyName = "apifyApiToken" | "ollamaCloudApiKey" | "runningHubApiKey";

export type OllamaModel = {
  name: string;
};

export type ConnectionSaveInput = {
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  generationPrefixOptions?: string;
  generationPrefixSelection?: string;
  runningHubWorkflowId?: string;
  runningHubBindings?: RunningHubBinding[];
};

export type HealthResponse = {
  ok: boolean;
  importProvider?: string;
  version?: string;
};

export type PublicConnections = {
  hasApifyApiToken: boolean;
  apifyApiTokenPreview?: string;
  hasOllamaCloudApiKey?: boolean;
  ollamaCloudApiKeyPreview?: string;
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  generationPrefixOptions?: string;
  generationPrefixSelection?: string;
  hasRunningHubApiKey: boolean;
  runningHubApiKeyPreview?: string;
  runningHubWorkflowId?: string;
  runningHubBindings?: RunningHubBinding[];
};

export async function listImports(): Promise<ImportsSessionResponse> {
  const response = await apiFetch("/api/imports");
  await assertOk(response);
  const data = (await response.json()) as ImportsResponse;
  const session = data.session ?? createEmptySession(data.sessionItemIds ?? []);
  return {
    items: data.items,
    session,
    sessionItemIds: data.sessionItemIds ?? session.itemIds
  };
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await apiFetch("/api/health");
  await assertOk(response);
  return await response.json() as HealthResponse;
}

export async function getConnections(): Promise<PublicConnections> {
  const response = await apiFetch("/api/connections");
  await assertOk(response);
  return await response.json() as PublicConnections;
}

export async function saveConnections(input: ConnectionSaveInput): Promise<PublicConnections> {
  const response = await apiFetch("/api/connections", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await assertOk(response);
  return await response.json() as PublicConnections;
}

export async function saveConnectionKey(keyName: ConnectionKeyName, key: string): Promise<void> {
  const response = await apiFetch(`/api/connections/keys/${keyName}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ key })
  });
  await assertOk(response);
}

export async function clearConnectionKey(keyName: ConnectionKeyName): Promise<void> {
  const response = await apiFetch(`/api/connections/keys/${keyName}`, { method: "DELETE" });
  await assertOk(response);
}

export async function listOllamaModels(provider: "cloud" | "local"): Promise<OllamaModel[]> {
  const response = await apiFetch(`/api/ollama/models?provider=${provider}`);
  await assertOk(response);
  const data = await response.json() as { models?: OllamaModel[] };
  return data.models ?? [];
}

export async function importInstagramUrl(
  url: string,
  options: { forceRefresh?: boolean } = {}
): Promise<ImportInstagramResult> {
  const response = await apiFetch("/api/imports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url, forceRefresh: options.forceRefresh === true })
  });
  await assertOk(response);
  const data = (await response.json()) as ImportResponse;
  return {
    item: data.item,
    session: data.session ?? createEmptySession([data.item.id]),
    reused: data.reused === true
  };
}

export async function uploadLocalImage(
  file: File,
  options: { appendToSession?: boolean } = {}
): Promise<ImportInstagramResult> {
  const response = await apiFetch("/api/imports/upload-image", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      ...(options.appendToSession ? { "X-Append-To-Session": "true" } : {})
    },
    body: file
  });
  await assertOk(response);
  const data = await response.json() as ImportResponse;
  return {
    item: data.item,
    session: data.session ?? createEmptySession([data.item.id]),
    reused: false
  };
}

export async function cleanupDuplicateImports(): Promise<CleanupImportsResult> {
  const response = await apiFetch("/api/imports/cleanup", { method: "POST" });
  await assertOk(response);
  const data = await response.json() as CleanupImportsResponse;
  return {
    items: data.items,
    session: data.session ?? createEmptySession(data.sessionItemIds ?? []),
    retainedItemIds: data.retainedItemIds,
    deletedItemIds: data.deletedItemIds
  };
}

export async function openImportsFolder(): Promise<void> {
  const response = await apiFetch("/api/open-imports-folder", { method: "POST" });
  await assertOk(response);
}

export async function resetMediaSession(): Promise<CurrentMediaSession> {
  const response = await apiFetch("/api/imports/session/reset", { method: "POST" });
  await assertOk(response);
  const data = await response.json() as { session?: CurrentMediaSession; sessionItemIds?: string[] };
  return data.session ?? createEmptySession(data.sessionItemIds ?? []);
}

export async function saveSessionPrompts(prompts: Record<string, string>): Promise<CurrentMediaSession> {
  const response = await apiFetch("/api/imports/session/prompts", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompts })
  });
  await assertOk(response);
  const data = await response.json() as { session?: CurrentMediaSession };
  return data.session ?? createEmptySession();
}

export async function generateImagePrompts(media: PromptMediaInput[]): Promise<PromptGenerationResult> {
  return await generateImagePromptsWithOptions(media);
}

export async function generateImagePromptsWithOptions(media: PromptMediaInput[], options: { signal?: AbortSignal } = {}): Promise<PromptGenerationResult> {
  const response = await apiFetch("/api/generation/image-prompts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ media }),
    ...(options.signal ? { signal: options.signal } : {})
  });
  await assertOk(response);
  const data = await response.json() as PromptGenerationResponse;
  return {
    prompts: data.prompts,
    session: data.session ?? createEmptySession()
  };
}

export async function generateImages(jobs: ImageGenerationJobInput[]): Promise<ImageGenerationResult> {
  return await generateImagesWithOptions(jobs);
}

export async function generateImagesWithOptions(jobs: ImageGenerationJobInput[], options: { signal?: AbortSignal } = {}): Promise<ImageGenerationResult> {
  const response = await apiFetch("/api/generation/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jobs }),
    ...(options.signal ? { signal: options.signal } : {})
  });
  await assertOk(response);
  const data = await response.json() as ImageGenerationResponse;
  return {
    item: data.item,
    session: data.session ?? createEmptySession()
  };
}

export async function cancelGeneration(): Promise<{ cancelled: boolean }> {
  const response = await apiFetch("/api/generation/cancel", { method: "POST" });
  await assertOk(response);
  return await response.json() as { cancelled: boolean };
}

function createEmptySession(itemIds: string[] = []): CurrentMediaSession {
  return {
    itemIds,
    sceneBibles: [],
    mediaSceneMap: {}
  };
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return init ? await fetch(input, init) : await fetch(input);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    const message = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Local API is not reachable. Make sure ./start.sh is running and http://127.0.0.1:4317/api/health responds. Original error: ${message}`);
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `Request failed with ${response.status}`;
  try {
    const data = (await response.json()) as ErrorResponse;
    if (data.error) {
      message = data.error;
    }
  } catch {
    // Keep the status-based fallback.
  }

  throw new Error(message);
}
