import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { legacyRunningHubBindings, normalizeRunningHubBindings, type RunningHubBinding } from "../src/lib/studioBindings";
import type { OllamaPreset, RunningHubWorkflowPreset, StudioActionButton } from "../src/lib/generationPresets";

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
  runningHubWorkflows?: RunningHubWorkflowPreset[];
  ollamaPresets?: OllamaPreset[];
  studioActionButtons?: StudioActionButton[];
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
  runningHubWorkflows: RunningHubWorkflowPreset[];
  ollamaPresets: OllamaPreset[];
  studioActionButtons: StudioActionButton[];
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
    const runningHubWorkflows = getRunningHubWorkflows(connections);
    const ollamaPresets = getOllamaPresets(connections);

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
      ...(migratedRunningHubBindings.length > 0 ? { runningHubBindings: migratedRunningHubBindings } : {}),
      runningHubWorkflows,
      ollamaPresets,
      studioActionButtons: normalizeStudioActionButtons(connections.studioActionButtons, runningHubWorkflows, ollamaPresets)
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
    const runningHubWorkflows = next.runningHubWorkflows === undefined ? getRunningHubWorkflows(current) : normalizeRunningHubWorkflows(next.runningHubWorkflows);
    const ollamaPresets = next.ollamaPresets === undefined ? getOllamaPresets(current) : normalizeOllamaPresets(next.ollamaPresets);
    const studioActionButtons = next.studioActionButtons === undefined
      ? normalizeStudioActionButtons(current.studioActionButtons, runningHubWorkflows, ollamaPresets)
      : normalizeStudioActionButtons(next.studioActionButtons, runningHubWorkflows, ollamaPresets);

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
      ...(next.runningHubWorkflows !== undefined || current.runningHubWorkflows !== undefined || runningHubWorkflows.length > 0 ? { runningHubWorkflows } : {}),
      ...(next.ollamaPresets !== undefined || current.ollamaPresets !== undefined || ollamaPresets.length > 0 ? { ollamaPresets } : {}),
      ...(next.studioActionButtons !== undefined || current.studioActionButtons !== undefined ? { studioActionButtons } : {}),
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

export function getRunningHubWorkflows(connections: PrivateConnections): RunningHubWorkflowPreset[] {
  if (connections.runningHubWorkflows !== undefined) return normalizeRunningHubWorkflows(connections.runningHubWorkflows);
  if (!connections.runningHubWorkflowId?.trim()) return [];
  return [{ id: "rh-legacy-01", displayId: "RH01", workflowId: connections.runningHubWorkflowId.trim(), bindings: normalizeRunningHubBindings(connections.runningHubBindings).length ? normalizeRunningHubBindings(connections.runningHubBindings) : legacyRunningHubBindings(connections) }];
}

export function getOllamaPresets(connections: PrivateConnections): OllamaPreset[] {
  if (connections.ollamaPresets !== undefined) return normalizeOllamaPresets(connections.ollamaPresets);
  const provider = connections.ollamaProvider ?? "local";
  const model = provider === "cloud" ? connections.ollamaCloudModel : connections.ollamaLocalModel;
  if (!model?.trim() && !connections.ollamaPromptInstruction?.trim()) return [];
  return [{ id: "ol-legacy-01", displayId: "OL01", provider, model: model?.trim() ?? "", promptInstruction: connections.ollamaPromptInstruction ?? "" }];
}

function normalizeRunningHubWorkflows(items: RunningHubWorkflowPreset[]): RunningHubWorkflowPreset[] {
  return items.flatMap((item) => typeof item?.id === "string" && typeof item.displayId === "string" ? [{ id: item.id.trim(), displayId: item.displayId.trim(), workflowId: typeof item.workflowId === "string" ? item.workflowId.trim() : "", bindings: normalizeRunningHubBindings(item.bindings) }] : []);
}

function normalizeOllamaPresets(items: OllamaPreset[]): OllamaPreset[] {
  return items.flatMap((item) => typeof item?.id === "string" && typeof item.displayId === "string" ? [{ id: item.id.trim(), displayId: item.displayId.trim(), provider: item.provider === "cloud" ? "cloud" : "local", model: typeof item.model === "string" ? item.model.trim() : "", promptInstruction: typeof item.promptInstruction === "string" ? item.promptInstruction.trim() : "" }] : []);
}

function normalizeStudioActionButtons(items: StudioActionButton[] | undefined, workflows: RunningHubWorkflowPreset[], presets: OllamaPreset[]): StudioActionButton[] {
  const workflowIds = new Set(workflows.map((item) => item.id));
  const presetIds = new Set(presets.map((item) => item.id));
  return (items ?? []).flatMap((item) => {
    if (!item || typeof item.id !== "string" || typeof item.label !== "string" || !Number.isInteger(item.order) || (item.type !== "text" && item.type !== "image")) return [];
    const presetId = typeof item.presetId === "string" && (item.type === "text" ? presetIds.has(item.presetId) : workflowIds.has(item.presetId)) ? item.presetId : undefined;
    return [{ id: item.id, label: item.label, type: item.type, ...(presetId ? { presetId } : {}), order: item.order }];
  }).sort((left, right) => left.order - right.order).map((item, order) => ({ ...item, order }));
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
