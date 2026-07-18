export const studioIds = ["1", "2", "3", "4"] as const;

export type StudioId = typeof studioIds[number];

export type RunningHubBinding = {
  nodeId: string;
  fieldName: string;
  studioId: StudioId;
};

export function isStudioId(value: unknown): value is StudioId {
  return typeof value === "string" && studioIds.includes(value as StudioId);
}

export function normalizeRunningHubBindings(value: unknown): RunningHubBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
    const fieldName = typeof record.fieldName === "string" ? record.fieldName.trim() : "";
    if (!nodeId || !fieldName || !isStudioId(record.studioId)) {
      return [];
    }
    return [{ nodeId, fieldName, studioId: record.studioId }];
  });
}

export function validateRunningHubBindings(value: unknown): RunningHubBinding[] {
  if (!Array.isArray(value)) {
    throw new Error("Workflow bindings must be an array.");
  }

  const bindings = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Each workflow binding must include Node ID, Field, and Studio ID.");
    }
    const record = candidate as Record<string, unknown>;
    const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
    const fieldName = typeof record.fieldName === "string" ? record.fieldName.trim() : "";
    if (!nodeId || !fieldName || !isStudioId(record.studioId)) {
      throw new Error("Each workflow binding must include Node ID, Field, and Studio ID.");
    }
    return { nodeId, fieldName, studioId: record.studioId };
  });
  assertUniqueRunningHubBindings(bindings);
  return bindings;
}

export function assertUniqueRunningHubBindings(bindings: RunningHubBinding[]): void {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.nodeId}\u0000${binding.fieldName}`;
    if (seen.has(key)) {
      throw new Error(`Node ${binding.nodeId} field ${binding.fieldName} is configured more than once.`);
    }
    seen.add(key);
  }
}

export function legacyRunningHubBindings(settings: {
  runningHubImageNodeId?: string;
  runningHubImageFieldName?: string;
  runningHubPromptNodeId?: string;
  runningHubPromptFieldName?: string;
}): RunningHubBinding[] {
  const bindings: RunningHubBinding[] = [];
  const imageNodeId = settings.runningHubImageNodeId?.trim();
  const imageFieldName = settings.runningHubImageFieldName?.trim();
  if (imageNodeId && imageFieldName) {
    bindings.push({ nodeId: imageNodeId, fieldName: imageFieldName, studioId: "1" });
  }
  const promptNodeId = settings.runningHubPromptNodeId?.trim();
  const promptFieldName = settings.runningHubPromptFieldName?.trim();
  if (promptNodeId && promptFieldName) {
    bindings.push({ nodeId: promptNodeId, fieldName: promptFieldName, studioId: "2" });
  }
  return bindings;
}
