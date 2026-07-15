import type { CurrentMediaSession, ImportItem } from "./importTypes";
import type { PromptMediaInput } from "./promptTypes";

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

type ImportCheckResponse = {
  ok: boolean;
  sourceUrl: string;
  provider: "scrapecreators";
  error?: string;
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

export type ConnectionKeyName = "scrapeCreatorsApiKey" | "ollamaCloudApiKey" | "runningHubApiKey";

export type OllamaModel = {
  name: string;
};

export type ConnectionSaveInput = {
  scrapeCreatorsApiKey?: string;
  ollamaCloudApiKey?: string;
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  runningHubApiKey?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
};

export type HealthResponse = {
  ok: boolean;
  importProvider?: string;
  version?: string;
};

export type PublicConnections = {
  hasScrapeCreatorsApiKey: boolean;
  scrapeCreatorsApiKeyPreview?: string;
  hasOllamaCloudApiKey?: boolean;
  ollamaCloudApiKeyPreview?: string;
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  hasRunningHubApiKey: boolean;
  runningHubApiKeyPreview?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
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

export async function getConnectionKey(keyName: ConnectionKeyName): Promise<string> {
  const response = await apiFetch(`/api/connections/keys/${keyName}`);
  await assertOk(response);
  const data = await response.json() as { key?: string };
  return data.key ?? "";
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

export async function uploadLocalImage(file: File): Promise<ImportInstagramResult> {
  const response = await apiFetch("/api/imports/upload-image", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": file.name
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

export async function checkInstagramUrl(url: string): Promise<ImportCheckResponse> {
  const response = await apiFetch("/api/imports/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });
  const data = (await response.json()) as ImportCheckResponse | ErrorResponse;
  if (!response.ok && "error" in data) {
    return {
      ok: false,
      sourceUrl: url,
      provider: "scrapecreators",
      error: data.error
    };
  }
  return data as ImportCheckResponse;
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

export async function generateImagePrompts(media: PromptMediaInput[]): Promise<PromptGenerationResult> {
  const response = await apiFetch("/api/generation/image-prompts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ media })
  });
  await assertOk(response);
  const data = await response.json() as PromptGenerationResponse;
  return {
    prompts: data.prompts,
    session: data.session ?? createEmptySession()
  };
}

export async function generateImages(jobs: ImageGenerationJobInput[]): Promise<ImageGenerationResult> {
  const response = await apiFetch("/api/generation/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jobs })
  });
  await assertOk(response);
  const data = await response.json() as ImageGenerationResponse;
  return {
    item: data.item,
    session: data.session ?? createEmptySession()
  };
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
