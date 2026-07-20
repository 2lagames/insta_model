import { getOllamaPresets, type PrivateConnections } from "./connectionsStore";

export function getActiveOllamaConfiguration(connections: PrivateConnections): {
  provider: "cloud" | "local";
  apiKey?: string;
  model: string;
  instruction: string;
} {
  const provider = connections.ollamaProvider ?? "local";
  const model = provider === "cloud" ? connections.ollamaCloudModel : connections.ollamaLocalModel;
  if (!model?.trim()) {
    throw new Error(`Select an Ollama ${provider === "cloud" ? "Cloud" : "local"} model on the Подключения tab before prompt generation.`);
  }
  if (provider === "cloud" && !connections.ollamaCloudApiKey?.trim()) {
    throw new Error("Add Ollama Cloud API key on the Подключения tab before prompt generation.");
  }
  if (!connections.ollamaPromptInstruction?.trim()) {
    throw new Error("Add a prompt instruction on the Подключения tab before prompt generation.");
  }
  return {
    provider,
    apiKey: connections.ollamaCloudApiKey,
    model,
    instruction: connections.ollamaPromptInstruction.trim()
  };
}

export function getOllamaConfigurationForPreset(connections: PrivateConnections, presetId: string) {
  const preset = getOllamaPresets(connections).find((item) => item.id === presetId);
  if (!preset) throw new Error("Select an available Ollama workflow before prompt generation.");
  if (!preset.model) throw new Error(`Select an Ollama ${preset.provider === "cloud" ? "Cloud" : "local"} model before prompt generation.`);
  if (preset.provider === "cloud" && !connections.ollamaCloudApiKey?.trim()) throw new Error("Add Ollama Cloud API key on the Настройки tab before prompt generation.");
  if (!preset.promptInstruction) throw new Error("Add a prompt instruction before prompt generation.");
  return { provider: preset.provider, apiKey: connections.ollamaCloudApiKey, model: preset.model, instruction: preset.promptInstruction };
}
