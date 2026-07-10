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

type PromptGenerationResponse = {
  prompt: string;
  session?: CurrentMediaSession;
};

type ImageGenerationResponse = {
  prompt: string;
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
  prompt: string;
  item: ImportItem;
  session: CurrentMediaSession;
};

export type PromptGenerationResult = {
  prompt: string;
  session: CurrentMediaSession;
};

export type ConnectionSaveInput = {
  scrapeCreatorsApiKey?: string;
  runningHubApiKey?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubWorkflowFileName?: string;
  runningHubWorkflowJson?: string;
};

export type HealthResponse = {
  ok: boolean;
  importProvider?: string;
  version?: string;
};

export type PublicConnections = {
  hasScrapeCreatorsApiKey: boolean;
  scrapeCreatorsApiKeyPreview?: string;
  hasRunningHubApiKey: boolean;
  runningHubApiKeyPreview?: string;
  hasRunningHubWorkflow: boolean;
  runningHubWorkflowFileName?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
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
    prompt: data.prompt,
    session: data.session ?? createEmptySession()
  };
}

export async function generateImages(media: PromptMediaInput[]): Promise<ImageGenerationResult> {
  const response = await apiFetch("/api/generation/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ media })
  });
  await assertOk(response);
  const data = await response.json() as ImageGenerationResponse;
  return {
    prompt: data.prompt,
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
    return await fetch(input, init);
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
