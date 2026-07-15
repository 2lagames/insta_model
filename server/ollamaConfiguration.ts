import type { PrivateConnections } from "./connectionsStore";

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
