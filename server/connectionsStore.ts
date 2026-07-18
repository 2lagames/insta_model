import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { legacyRunningHubBindings, normalizeRunningHubBindings, type RunningHubBinding } from "../src/lib/studioBindings";

export type PrivateConnections = {
  apifyApiToken?: string;
  ollamaCloudApiKey?: string;
  ollamaProvider?: "cloud" | "local";
  ollamaCloudModel?: string;
  ollamaLocalModel?: string;
  ollamaPromptInstruction?: string;
  generationPrefixOptions?: string;
  generationPrefixSelection?: string;
  runningHubApiKey?: string;
  runningHubWorkflowId?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
  runningHubBindings?: RunningHubBinding[];
};

export type ConnectionKeyName = "apifyApiToken" | "ollamaCloudApiKey" | "runningHubApiKey";

export type PublicConnections = {
  hasApifyApiToken: boolean;
  apifyApiTokenPreview?: string;
  hasOllamaCloudApiKey: boolean;
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
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
  runningHubBindings?: RunningHubBinding[];
};

export class ConnectionsStore {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, "connections.local.json");
  }

  async readPrivate(): Promise<PrivateConnections> {
    try {
      await this.ensurePrivateFilePermissions();
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
    const apifyApiToken = connections.apifyApiToken?.trim();
    const ollamaCloudApiKey = connections.ollamaCloudApiKey?.trim();
    const runningHubApiKey = connections.runningHubApiKey?.trim();

    const runningHubBindings = normalizeRunningHubBindings(connections.runningHubBindings);
    const migratedRunningHubBindings = runningHubBindings.length > 0
      ? runningHubBindings
      : legacyRunningHubBindings(connections);

    return {
      hasApifyApiToken: Boolean(apifyApiToken),
      ...(apifyApiToken ? { apifyApiTokenPreview: maskSecret(apifyApiToken) } : {}),
      hasOllamaCloudApiKey: Boolean(ollamaCloudApiKey),
      ...(ollamaCloudApiKey ? { ollamaCloudApiKeyPreview: maskSecret(ollamaCloudApiKey) } : {}),
      ...(connections.ollamaProvider ? { ollamaProvider: connections.ollamaProvider } : {}),
      ...(connections.ollamaCloudModel ? { ollamaCloudModel: connections.ollamaCloudModel } : {}),
      ...(connections.ollamaLocalModel ? { ollamaLocalModel: connections.ollamaLocalModel } : {}),
      ollamaPromptInstruction: connections.ollamaPromptInstruction ?? "",
      ...(connections.generationPrefixOptions !== undefined ? { generationPrefixOptions: connections.generationPrefixOptions } : {}),
      ...(connections.generationPrefixSelection ? { generationPrefixSelection: connections.generationPrefixSelection } : {}),
      hasRunningHubApiKey: Boolean(runningHubApiKey),
      ...(runningHubApiKey ? { runningHubApiKeyPreview: maskSecret(runningHubApiKey) } : {}),
      ...(connections.runningHubWorkflowId ? { runningHubWorkflowId: connections.runningHubWorkflowId } : {}),
      ...(connections.runningHubPromptNodeId ? { runningHubPromptNodeId: connections.runningHubPromptNodeId } : {}),
      ...(connections.runningHubPromptFieldName ? { runningHubPromptFieldName: connections.runningHubPromptFieldName } : {}),
      ...(connections.runningHubImageNodeId ? { runningHubImageNodeId: connections.runningHubImageNodeId } : {}),
      ...(connections.runningHubImageFieldName ? { runningHubImageFieldName: connections.runningHubImageFieldName } : {}),
      ...(migratedRunningHubBindings.length > 0 ? { runningHubBindings: migratedRunningHubBindings } : {})
    };
  }

  async saveKey(keyName: ConnectionKeyName, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("API key cannot be blank. Use Clear to remove the saved key.");
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
    const apifyApiToken = normalizeSecret(next.apifyApiToken, current.apifyApiToken);
    const ollamaCloudApiKey = normalizeSecret(next.ollamaCloudApiKey, current.ollamaCloudApiKey);
    const runningHubApiKey = normalizeSecret(next.runningHubApiKey, current.runningHubApiKey);
    const runningHubWorkflowId = normalizeSetting(next.runningHubWorkflowId, current.runningHubWorkflowId);
    const hasRunningHubBindingsUpdate = next.runningHubBindings !== undefined;
    const runningHubPromptNodeId = hasRunningHubBindingsUpdate ? undefined : normalizeSetting(next.runningHubPromptNodeId, current.runningHubPromptNodeId);
    const runningHubPromptFieldName = hasRunningHubBindingsUpdate ? undefined : normalizeSetting(next.runningHubPromptFieldName, current.runningHubPromptFieldName);
    const ollamaProvider = next.ollamaProvider ?? current.ollamaProvider;
    const ollamaCloudModel = normalizeSetting(next.ollamaCloudModel, current.ollamaCloudModel);
    const ollamaLocalModel = normalizeSetting(next.ollamaLocalModel, current.ollamaLocalModel);
    const ollamaPromptInstruction = next.ollamaPromptInstruction === undefined
      ? current.ollamaPromptInstruction
      : next.ollamaPromptInstruction.trim();
    const generationPrefixOptions = next.generationPrefixOptions === undefined ? current.generationPrefixOptions : next.generationPrefixOptions;
    const generationPrefixSelection = normalizeSetting(next.generationPrefixSelection, current.generationPrefixSelection);
    const runningHubImageNodeId = hasRunningHubBindingsUpdate ? undefined : normalizeSetting(next.runningHubImageNodeId, current.runningHubImageNodeId);
    const runningHubImageFieldName = hasRunningHubBindingsUpdate ? undefined : normalizeSetting(next.runningHubImageFieldName, current.runningHubImageFieldName);
    const runningHubBindings = next.runningHubBindings === undefined
      ? normalizeRunningHubBindings(current.runningHubBindings)
      : normalizeRunningHubBindings(next.runningHubBindings);

    const data: PrivateConnections = {
      ...(apifyApiToken ? { apifyApiToken } : {}),
      ...(ollamaCloudApiKey ? { ollamaCloudApiKey } : {}),
      ...(ollamaProvider ? { ollamaProvider } : {}),
      ...(ollamaCloudModel ? { ollamaCloudModel } : {}),
      ...(ollamaLocalModel ? { ollamaLocalModel } : {}),
      ...(ollamaPromptInstruction !== undefined ? { ollamaPromptInstruction } : {}),
      ...(generationPrefixOptions !== undefined ? { generationPrefixOptions } : {}),
      ...(generationPrefixSelection ? { generationPrefixSelection } : {}),
      ...(runningHubApiKey ? { runningHubApiKey } : {}),
      ...(runningHubWorkflowId ? { runningHubWorkflowId } : {}),
      ...(runningHubPromptNodeId ? { runningHubPromptNodeId } : {}),
      ...(runningHubPromptFieldName ? { runningHubPromptFieldName } : {}),
      ...(runningHubImageNodeId ? { runningHubImageNodeId } : {}),
      ...(runningHubImageFieldName ? { runningHubImageFieldName } : {}),
      ...(runningHubBindings.length > 0 ? { runningHubBindings } : {}),
    };

    await this.write(data);
  }

  private async write(data: PrivateConnections): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    await this.ensurePrivateFilePermissions();
  }

  private async ensurePrivateFilePermissions(): Promise<void> {
    if (process.platform !== "win32") {
      await chmod(this.filePath, 0o600);
    }
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
