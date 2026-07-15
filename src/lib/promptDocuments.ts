export type PromptDocument = {
  mediaId: string;
  label: string;
  original: string;
  history: string[];
  historyIndex: number;
};

type PromptDocumentInput = {
  mediaId: string;
  label: string;
  prompt: string;
};

export function createPromptDocuments(prompts: PromptDocumentInput[]): PromptDocument[] {
  return prompts.map((prompt) => ({
    mediaId: prompt.mediaId,
    label: prompt.label,
    original: prompt.prompt,
    history: [prompt.prompt],
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

export function getCurrentPrompt(document: PromptDocument): string {
  return document.history[document.historyIndex];
}

export function createPromptTextRecord(documents: PromptDocument[]): Record<string, string> {
  return Object.fromEntries(documents.map((document) => [document.mediaId, getCurrentPrompt(document)]));
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

    const nextHistory = [...document.history.slice(0, document.historyIndex + 1), value];
    return { ...document, history: nextHistory, historyIndex: nextHistory.length - 1 };
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

export function resetPromptDocument(documents: PromptDocument[], mediaId: string): PromptDocument[] {
  return updatePromptDocument(documents, mediaId, (document) => ({
    ...document,
    history: [document.original],
    historyIndex: 0,
  }));
}

function updatePromptDocument(
  documents: PromptDocument[],
  mediaId: string,
  update: (document: PromptDocument) => PromptDocument,
): PromptDocument[] {
  return documents.map((document) => (document.mediaId === mediaId ? update(document) : document));
}
