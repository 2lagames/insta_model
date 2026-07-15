export type OllamaProvider = "cloud" | "local";

export type OllamaModel = {
  name: string;
};

type FetchLike = typeof fetch;

export type ListOllamaModelsInput = {
  provider: OllamaProvider;
  apiKey?: string;
  fetchImpl?: FetchLike;
};

export type GenerateOllamaPromptInput = {
  provider: OllamaProvider;
  apiKey?: string;
  model: string;
  prompt: string;
  imageBase64: string;
  fetchImpl?: FetchLike;
};

const cloudBaseUrl = "https://ollama.com";
const localBaseUrl = "http://127.0.0.1:11434";

export async function listOllamaModels(input: ListOllamaModelsInput): Promise<OllamaModel[]> {
  const response = await getFetch(input.fetchImpl)(new URL("/api/tags", getBaseUrl(input.provider)), getAuthInit(input));
  if (!response.ok) {
    throw new Error(`Ollama model list failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as { models?: Array<{ name?: unknown }> };
  return payload.models?.flatMap((model) => typeof model.name === "string" ? [{ name: model.name }] : []) ?? [];
}

export async function generateOllamaPrompt(input: GenerateOllamaPromptInput): Promise<string> {
  const response = await getFetch(input.fetchImpl)(new URL("/api/generate", getBaseUrl(input.provider)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthorizationHeader(input)
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      images: [input.imageBase64],
      stream: false
    })
  });
  if (!response.ok) {
    throw new Error(`Ollama prompt generation failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as { response?: string; error?: string };
  if (payload.error) {
    throw new Error(`Ollama prompt generation failed: ${payload.error}`);
  }
  return (payload.response ?? "").trim();
}

function getBaseUrl(provider: OllamaProvider): string {
  return provider === "cloud" ? cloudBaseUrl : localBaseUrl;
}

function getAuthInit(input: Pick<ListOllamaModelsInput, "provider" | "apiKey">): RequestInit | undefined {
  const headers = getAuthorizationHeader(input);
  return Object.keys(headers).length > 0 ? { headers } : undefined;
}

function getAuthorizationHeader(input: Pick<ListOllamaModelsInput, "provider" | "apiKey">): Record<string, string> {
  if (input.provider !== "cloud") {
    return {};
  }

  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Ollama Cloud API key is required.");
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function getFetch(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? fetch;
}
