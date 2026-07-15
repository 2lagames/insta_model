import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PrivateConnections = {
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
  runningHubWorkflowFileName?: string;
  runningHubWorkflowJson?: string;
};

export type ConnectionKeyName = "scrapeCreatorsApiKey" | "ollamaCloudApiKey" | "runningHubApiKey";

export type PublicConnections = {
  hasScrapeCreatorsApiKey: boolean;
  scrapeCreatorsApiKeyPreview?: string;
  hasOllamaCloudApiKey: boolean;
  ollamaCloudApiKeyPreview?: string;
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  hasRunningHubApiKey: boolean;
  runningHubApiKeyPreview?: string;
  hasRunningHubWorkflow: boolean;
  runningHubWorkflowFileName?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
};

export class ConnectionsStore {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, "connections.local.json");
  }

  async readPrivate(): Promise<PrivateConnections> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as PrivateConnections;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async readPublic(): Promise<PublicConnections> {
    const connections = await this.readPrivate();
    const apiKey = connections.scrapeCreatorsApiKey?.trim();
    const ollamaCloudApiKey = connections.ollamaCloudApiKey?.trim();
    const runningHubApiKey = connections.runningHubApiKey?.trim();
    const runningHubWorkflowJson = connections.runningHubWorkflowJson?.trim();

    return {
      hasScrapeCreatorsApiKey: Boolean(apiKey),
      ...(apiKey ? { scrapeCreatorsApiKeyPreview: maskSecret(apiKey) } : {}),
      hasOllamaCloudApiKey: Boolean(ollamaCloudApiKey),
      ...(ollamaCloudApiKey ? { ollamaCloudApiKeyPreview: maskSecret(ollamaCloudApiKey) } : {}),
      ...(connections.ollamaProvider ? { ollamaProvider: connections.ollamaProvider } : {}),
      ...(connections.ollamaCloudModel ? { ollamaCloudModel: connections.ollamaCloudModel } : {}),
      ...(connections.ollamaLocalModel ? { ollamaLocalModel: connections.ollamaLocalModel } : {}),
      ...(connections.ollamaPromptInstruction ? { ollamaPromptInstruction: connections.ollamaPromptInstruction } : {}),
      hasRunningHubApiKey: Boolean(runningHubApiKey),
      ...(runningHubApiKey ? { runningHubApiKeyPreview: maskSecret(runningHubApiKey) } : {}),
      hasRunningHubWorkflow: Boolean(runningHubWorkflowJson),
      ...(connections.runningHubWorkflowFileName ? { runningHubWorkflowFileName: connections.runningHubWorkflowFileName } : {}),
      ...(connections.runningHubWorkflowId ? { runningHubWorkflowId: connections.runningHubWorkflowId } : {}),
      ...(connections.runningHubPromptNodeId ? { runningHubPromptNodeId: connections.runningHubPromptNodeId } : {}),
      ...(connections.runningHubPromptFieldName ? { runningHubPromptFieldName: connections.runningHubPromptFieldName } : {}),
      ...(connections.runningHubImageNodeId ? { runningHubImageNodeId: connections.runningHubImageNodeId } : {}),
      ...(connections.runningHubImageFieldName ? { runningHubImageFieldName: connections.runningHubImageFieldName } : {})
    };
  }

  async readKey(keyName: ConnectionKeyName): Promise<string | undefined> {
    const connections = await this.readPrivate();
    return connections[keyName]?.trim() || undefined;
  }

  async saveKey(keyName: ConnectionKeyName, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      await this.clearKey(keyName);
      return;
    }

    const current = await this.readPrivate();
    await this.write({ ...current, [keyName]: trimmed });
  }

  async clearKey(keyName: ConnectionKeyName): Promise<void> {
    const current = await this.readPrivate();
    delete current[keyName];
    await this.write(current);
  }

  async save(next: PrivateConnections): Promise<void> {
    const current = await this.readPrivate();
    const scrapeCreatorsApiKey = normalizeSecret(next.scrapeCreatorsApiKey, current.scrapeCreatorsApiKey);
    const ollamaCloudApiKey = normalizeSecret(next.ollamaCloudApiKey, current.ollamaCloudApiKey);
    const runningHubApiKey = normalizeSecret(next.runningHubApiKey, current.runningHubApiKey);
    const runningHubWorkflowJson = next.runningHubWorkflowJson?.trim()
      ? next.runningHubWorkflowJson
      : current.runningHubWorkflowJson;
    const runningHubWorkflowFileName = next.runningHubWorkflowJson?.trim()
      ? next.runningHubWorkflowFileName?.trim()
      : next.runningHubWorkflowFileName?.trim() || current.runningHubWorkflowFileName;
    const runningHubWorkflowId = normalizeSetting(next.runningHubWorkflowId, current.runningHubWorkflowId);
    const runningHubPromptNodeId = normalizeSetting(next.runningHubPromptNodeId, current.runningHubPromptNodeId);
    const runningHubPromptFieldName = normalizeSetting(next.runningHubPromptFieldName, current.runningHubPromptFieldName);
    const ollamaProvider = next.ollamaProvider ?? current.ollamaProvider;
    const ollamaCloudModel = normalizeSetting(next.ollamaCloudModel, current.ollamaCloudModel);
    const ollamaLocalModel = normalizeSetting(next.ollamaLocalModel, current.ollamaLocalModel);
    const ollamaPromptInstruction = normalizeSetting(next.ollamaPromptInstruction, current.ollamaPromptInstruction);
    const runningHubImageNodeId = normalizeSetting(next.runningHubImageNodeId, current.runningHubImageNodeId);
    const runningHubImageFieldName = normalizeSetting(next.runningHubImageFieldName, current.runningHubImageFieldName);

    const data: PrivateConnections = {
      ...(scrapeCreatorsApiKey ? { scrapeCreatorsApiKey } : {}),
      ...(ollamaCloudApiKey ? { ollamaCloudApiKey } : {}),
      ...(ollamaProvider ? { ollamaProvider } : {}),
      ...(ollamaCloudModel ? { ollamaCloudModel } : {}),
      ...(ollamaLocalModel ? { ollamaLocalModel } : {}),
      ...(ollamaPromptInstruction ? { ollamaPromptInstruction } : {}),
      ...(runningHubApiKey ? { runningHubApiKey } : {}),
      ...(runningHubWorkflowId ? { runningHubWorkflowId } : {}),
      ...(runningHubPromptNodeId ? { runningHubPromptNodeId } : {}),
      ...(runningHubPromptFieldName ? { runningHubPromptFieldName } : {}),
      ...(runningHubImageNodeId ? { runningHubImageNodeId } : {}),
      ...(runningHubImageFieldName ? { runningHubImageFieldName } : {}),
      ...(runningHubWorkflowFileName ? { runningHubWorkflowFileName } : {}),
      ...(runningHubWorkflowJson ? { runningHubWorkflowJson } : {})
    };

    await this.write(data);
  }

  private async write(data: PrivateConnections): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "*".repeat(secret.length);
  }

  return `${"*".repeat(secret.length - 4)}${secret.slice(-4)}`;
}

function normalizeSecret(nextSecret: string | undefined, currentSecret: string | undefined): string | undefined {
  const trimmed = nextSecret?.trim();
  if (!trimmed) {
    return currentSecret?.trim() || undefined;
  }

  if (currentSecret && trimmed === maskSecret(currentSecret)) {
    return currentSecret;
  }

  return trimmed;
}

function normalizeSetting(nextValue: string | undefined, currentValue: string | undefined): string | undefined {
  if (nextValue === undefined) {
    return currentValue?.trim() || undefined;
  }

  return nextValue.trim() || undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
