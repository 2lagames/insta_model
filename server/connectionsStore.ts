import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PrivateConnections = {
  scrapeCreatorsApiKey?: string;
  runningHubApiKey?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubWorkflowFileName?: string;
  runningHubWorkflowJson?: string;
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
    const runningHubApiKey = connections.runningHubApiKey?.trim();
    const runningHubWorkflowJson = connections.runningHubWorkflowJson?.trim();

    return {
      hasScrapeCreatorsApiKey: Boolean(apiKey),
      ...(apiKey ? { scrapeCreatorsApiKeyPreview: maskSecret(apiKey) } : {}),
      hasRunningHubApiKey: Boolean(runningHubApiKey),
      ...(runningHubApiKey ? { runningHubApiKeyPreview: maskSecret(runningHubApiKey) } : {}),
      hasRunningHubWorkflow: Boolean(runningHubWorkflowJson),
      ...(connections.runningHubWorkflowFileName ? { runningHubWorkflowFileName: connections.runningHubWorkflowFileName } : {}),
      ...(connections.runningHubWorkflowId ? { runningHubWorkflowId: connections.runningHubWorkflowId } : {}),
      ...(connections.runningHubPromptNodeId ? { runningHubPromptNodeId: connections.runningHubPromptNodeId } : {}),
      ...(connections.runningHubPromptFieldName ? { runningHubPromptFieldName: connections.runningHubPromptFieldName } : {})
    };
  }

  async save(next: PrivateConnections): Promise<void> {
    const current = await this.readPrivate();
    const scrapeCreatorsApiKey = normalizeSecret(next.scrapeCreatorsApiKey, current.scrapeCreatorsApiKey);
    const runningHubApiKey = normalizeSecret(next.runningHubApiKey, current.runningHubApiKey);
    const runningHubWorkflowJson = next.runningHubWorkflowJson?.trim()
      ? next.runningHubWorkflowJson
      : current.runningHubWorkflowJson;
    const runningHubWorkflowFileName = next.runningHubWorkflowJson?.trim()
      ? next.runningHubWorkflowFileName?.trim()
      : next.runningHubWorkflowFileName?.trim() || current.runningHubWorkflowFileName;
    const runningHubWorkflowId = next.runningHubWorkflowId?.trim();
    const runningHubPromptNodeId = next.runningHubPromptNodeId?.trim();
    const runningHubPromptFieldName = next.runningHubPromptFieldName?.trim();

    const data: PrivateConnections = {
      ...(scrapeCreatorsApiKey ? { scrapeCreatorsApiKey } : {}),
      ...(runningHubApiKey ? { runningHubApiKey } : {}),
      ...(runningHubWorkflowId ? { runningHubWorkflowId } : {}),
      ...(runningHubPromptNodeId ? { runningHubPromptNodeId } : {}),
      ...(runningHubPromptFieldName ? { runningHubPromptFieldName } : {}),
      ...(runningHubWorkflowFileName ? { runningHubWorkflowFileName } : {}),
      ...(runningHubWorkflowJson ? { runningHubWorkflowJson } : {})
    };

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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
