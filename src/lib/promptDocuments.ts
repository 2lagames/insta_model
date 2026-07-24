export type PromptDocument = {
  mediaId: string;
  label: string;
  original: string;
  history: string[];
  managedPrefixes: string[];
  historyIndex: number;
};

type PromptDocumentInput = {
  mediaId: string;
  label: string;
  prompt: string;
  managedPrefix?: string;
};

export function createPromptDocuments(prompts: PromptDocumentInput[]): PromptDocument[] {
  return prompts.map((prompt) => ({
    mediaId: prompt.mediaId,
    label: prompt.label,
    original: prompt.prompt,
    history: [prompt.prompt],
    managedPrefixes: [prompt.managedPrefix ?? ""],
    historyIndex: 0,
  }));
}

export function mergePromptDocuments(
  documents: PromptDocument[],
  prompts: PromptDocumentInput[],
): PromptDocument[] {
  const replacements = new Map(createPromptDocuments(prompts).map((document) => [document.mediaId, document]));
  const merged = documents.map((document) => replacements.get(document.mediaId) ?? document);
  const existingMediaIds = new Set(documents.map((document) => document.mediaId));

  return [
    ...merged,
    ...prompts
      .filter((prompt) => !existingMediaIds.has(prompt.mediaId))
      .map((prompt) => replacements.get(prompt.mediaId)!),
  ];
}

export function ensurePromptDocument(
  documents: PromptDocument[],
  prompt: PromptDocumentInput,
): PromptDocument[] {
  if (documents.some((document) => document.mediaId === prompt.mediaId)) {
    return documents;
  }

  return [...documents, ...createPromptDocuments([prompt])];
}

export function setPromptDocumentPrefix(
  documents: PromptDocument[],
  previousPrefix: string,
  nextPrefix: string,
): PromptDocument[] {
  return documents.reduce((current, document) => {
    const value = getCurrentPrompt(document);
    const managedPrefix = getCurrentPromptPrefix(document);
    const prefixToRemove = managedPrefix || previousPrefix;
    const withoutPreviousPrefix = removeLeadingPromptPart(value, prefixToRemove);
    const nextValue = hasLeadingPromptPart(value, nextPrefix) && !prefixToRemove.trim()
      ? value
      : joinPromptParts(nextPrefix, withoutPreviousPrefix);
    return updatePromptDocument(current, document.mediaId, (item) => addPromptHistory(item, nextValue, nextPrefix));
  }, documents);
}

export function appendPromptDocument(
  documents: PromptDocument[],
  prompt: PromptDocumentInput,
): PromptDocument[] {
  const ensured = ensurePromptDocument(documents, { ...prompt, prompt: "" });
  const document = ensured.find((item) => item.mediaId === prompt.mediaId)!;
  return editPromptDocument(
    ensured,
    prompt.mediaId,
    joinPromptParts(getCurrentPrompt(document), prompt.prompt),
  );
}

export function getCurrentPrompt(document: PromptDocument): string {
  return document.history[document.historyIndex];
}

export function createPromptTextRecord(documents: PromptDocument[]): Record<string, string> {
  return Object.fromEntries(documents.map((document) => [document.mediaId, getCurrentPrompt(document)]));
}

export function createPromptPrefixRecord(documents: PromptDocument[]): Record<string, string> {
  return Object.fromEntries(documents.map((document) => [document.mediaId, getCurrentPromptPrefix(document)]));
}

export function editPromptDocument(
  documents: PromptDocument[],
  mediaId: string,
  value: string,
): PromptDocument[] {
  return updatePromptDocument(documents, mediaId, (document) => {
    if (getCurrentPrompt(document) === value) {
      return document;
    }

    const managedPrefix = getCurrentPromptPrefix(document);
    const nextManagedPrefix = managedPrefix && !hasLeadingPromptPart(value, managedPrefix)
      ? ""
      : managedPrefix;
    return addPromptHistory(document, value, nextManagedPrefix);
  });
}

export function undoPromptDocument(documents: PromptDocument[], mediaId: string): PromptDocument[] {
  return updatePromptDocument(documents, mediaId, (document) => {
    if (document.historyIndex === 0) {
      return document;
    }

    return { ...document, historyIndex: document.historyIndex - 1 };
  });
}

export function redoPromptDocument(documents: PromptDocument[], mediaId: string): PromptDocument[] {
  return updatePromptDocument(documents, mediaId, (document) => {
    if (document.historyIndex === document.history.length - 1) {
      return document;
    }

    return { ...document, historyIndex: document.historyIndex + 1 };
  });
}

export function resetPromptDocument(documents: PromptDocument[], mediaId: string, managedPrefix = ""): PromptDocument[] {
  return updatePromptDocument(documents, mediaId, (document) => {
    const originalPrefix = document.managedPrefixes[0] ?? "";
    const originalBody = removeLeadingPromptPart(document.original, originalPrefix);
    const value = joinPromptParts(managedPrefix, originalBody);
    return {
      ...document,
      history: [value],
      managedPrefixes: [managedPrefix],
      historyIndex: 0,
    };
  });
}

function updatePromptDocument(
  documents: PromptDocument[],
  mediaId: string,
  update: (document: PromptDocument) => PromptDocument,
): PromptDocument[] {
  return documents.map((document) => (document.mediaId === mediaId ? update(document) : document));
}

function getCurrentPromptPrefix(document: PromptDocument): string {
  return document.managedPrefixes[document.historyIndex] ?? "";
}

function addPromptHistory(document: PromptDocument, value: string, managedPrefix: string): PromptDocument {
  const currentValue = getCurrentPrompt(document);
  const currentManagedPrefix = getCurrentPromptPrefix(document);
  if (currentValue === value && currentManagedPrefix === managedPrefix) {
    return document;
  }

  if (currentValue === value) {
    const managedPrefixes = [...document.managedPrefixes];
    managedPrefixes[document.historyIndex] = managedPrefix;
    return { ...document, managedPrefixes };
  }

  const nextHistory = [...document.history.slice(0, document.historyIndex + 1), value];
  const nextManagedPrefixes = [
    ...document.managedPrefixes.slice(0, document.historyIndex + 1),
    managedPrefix,
  ];
  return {
    ...document,
    history: nextHistory,
    managedPrefixes: nextManagedPrefixes,
    historyIndex: nextHistory.length - 1,
  };
}

function joinPromptParts(...parts: string[]): string {
  return parts
    .filter((part) => part.trim().length > 0)
    .map((part) => part.replace(/^\n+|\n+$/g, ""))
    .join("\n");
}

function hasLeadingPromptPart(value: string, part: string): boolean {
  const normalizedPart = part.replace(/^\n+|\n+$/g, "");
  return normalizedPart.length > 0
    && (value === normalizedPart || value.startsWith(`${normalizedPart}\n`));
}

function removeLeadingPromptPart(value: string, part: string): string {
  const normalizedPart = part.replace(/^\n+|\n+$/g, "");
  if (!normalizedPart || !hasLeadingPromptPart(value, normalizedPart)) {
    return value;
  }

  return value === normalizedPart ? "" : value.slice(normalizedPart.length + 1);
}
