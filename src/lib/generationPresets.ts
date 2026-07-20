import type { RunningHubBinding } from "./studioBindings";

export type StudioActionType = "text" | "image";

export type RunningHubWorkflowPreset = {
  id: string;
  displayId: string;
  workflowId: string;
  bindings: RunningHubBinding[];
};

export type OllamaPreset = {
  id: string;
  displayId: string;
  provider: "cloud" | "local";
  model: string;
  promptInstruction: string;
};

export type StudioActionButton = {
  id: string;
  label: string;
  type: StudioActionType;
  presetId?: string;
  order: number;
};

export function nextPresetDisplayId(prefix: "RH" | "OL", entries: Array<{ displayId: string }>): string {
  const highest = entries.reduce((value, entry) => Math.max(value, Number(new RegExp(`^${prefix}(\\d+)$`).exec(entry.displayId)?.[1] ?? 0)), 0);
  return `${prefix}${String(highest + 1).padStart(2, "0")}`;
}

export function reorderStudioActionButtons(buttons: StudioActionButton[], sourceId: string, targetId: string): StudioActionButton[] {
  const sourceIndex = buttons.findIndex((button) => button.id === sourceId);
  const targetIndex = buttons.findIndex((button) => button.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return buttons;
  const next = [...buttons];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next.map((button, order) => ({ ...button, order }));
}
