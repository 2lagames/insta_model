import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelGeneration,
  clearConnectionKey,
  generateImagePromptsWithOptions,
  generateImagesWithOptions,
  getConnections,
  getHealth,
  importInstagramUrl,
  listImports,
  listOllamaModels,
  openImportsFolder,
  resetMediaSession,
  saveConnectionKey,
  saveConnections,
  saveSessionPrompts,
  uploadLocalImage,
  type ConnectionKeyName,
  type PublicConnections
} from "./lib/api";
import type { CurrentMediaSession, ImportItem, SceneBible } from "./lib/importTypes";
import { validateInstagramUrl } from "./lib/instagramUrl";
import { createMediaMaterials, createSessionMediaMaterials, type MediaMaterial } from "./lib/mediaMaterials";
import { toggleAllMediaSelection, toggleMediaSelection } from "./lib/mediaSelection";
import {
  createPromptTextRecord,
  editPromptDocument,
  getCurrentPrompt,
  mergePromptDocuments,
  redoPromptDocument,
  resetPromptDocument,
  undoPromptDocument,
  type PromptDocument
} from "./lib/promptDocuments";
import type { PromptMediaInput } from "./lib/promptTypes";
import { createStatusLogText } from "./lib/statusLog";
import { studioIds, type RunningHubBinding } from "./lib/studioBindings";
import { nextPresetDisplayId, reorderStudioActionButtons, type OllamaPreset, type RunningHubWorkflowPreset, type StudioActionButton, type StudioActionType } from "./lib/generationPresets";

type ActiveTab = "studio" | "connections";
type StatusTone = "idle" | "running" | "error" | "ready";

type StatusState = {
  tone: StatusTone;
  message: string;
};

type ActivityLogEntry = StatusState & {
  id: string;
  createdAt: string;
  source?: string;
};

const emptyCurrentSession: CurrentMediaSession = {
  itemIds: [],
  sceneBibles: [],
  mediaSceneMap: {}
};

const emptyRunningHubBinding: RunningHubBinding = { nodeId: "", fieldName: "", studioId: "1" };

function getEditableRunningHubBindings(bindings: RunningHubBinding[]): RunningHubBinding[] {
  return bindings.length > 0 ? bindings : [emptyRunningHubBinding];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("studio");
  const [url, setUrl] = useState("");
  const [urlNotice, setUrlNotice] = useState<string | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [sessionMediaItemIds, setSessionMediaItemIds] = useState<string[]>([]);
  const [currentSession, setCurrentSession] = useState<CurrentMediaSession>(emptyCurrentSession);
  const [isMediaSessionReset, setIsMediaSessionReset] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "Ready" });
  const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([{
    id: "initial",
    tone: "idle",
    message: "Ready",
    createdAt: new Date().toISOString(),
    source: "ui"
  }]);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isBackendCurrent, setIsBackendCurrent] = useState(true);
  const [selectedForGeneration, setSelectedForGeneration] = useState<string[]>([]);
  const [imageGenerationsPerMedia, setImageGenerationsPerMedia] = useState(1);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [connections, setConnections] = useState<PublicConnections>({
    hasApifyApiToken: false,
    hasRunningHubApiKey: false,
    runningHubWorkflows: [],
    ollamaPresets: [],
    studioActionButtons: []
  });
  const [editingKey, setEditingKey] = useState<ConnectionKeyName | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [runningHubWorkflows, setRunningHubWorkflows] = useState<RunningHubWorkflowPreset[]>([]);
  const [ollamaPresets, setOllamaPresets] = useState<OllamaPreset[]>([]);
  const [studioActionButtons, setStudioActionButtons] = useState<StudioActionButton[]>([]);
  const [draggedStudioActionId, setDraggedStudioActionId] = useState<string | null>(null);
  const [generationPrefixOptions, setGenerationPrefixOptions] = useState("");
  const [generationPrefixSelection, setGenerationPrefixSelection] = useState("");
  const [isEditingGenerationPrefixes, setIsEditingGenerationPrefixes] = useState(false);
  const [cloudModels, setCloudModels] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [isRefreshingCloudModels, setIsRefreshingCloudModels] = useState(false);
  const [isRefreshingLocalModels, setIsRefreshingLocalModels] = useState(false);
  const [isSavingConnections, setIsSavingConnections] = useState(false);
  const [promptDocuments, setPromptDocuments] = useState<PromptDocument[]>([]);
  const promptAutosaveRevisionRef = useRef(0);
  const isPromptAutosaveReadyRef = useRef(false);
  const localImageInputRef = useRef<HTMLInputElement | null>(null);
  const isSessionMutationBusyRef = useRef(false);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const isSessionMutationBusy = isImporting || isResetting || isSavingPrompt || isGeneratingPrompt || isGeneratingImages;

  function tryBeginSessionMutation() {
    if (isSessionMutationBusyRef.current) {
      return false;
    }

    isSessionMutationBusyRef.current = true;
    return true;
  }

  function endSessionMutation() {
    isSessionMutationBusyRef.current = false;
  }

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? (isMediaSessionReset ? undefined : items[0]),
    [items, selectedItemId, isMediaSessionReset]
  );
  const mediaMaterials = useMemo(
    () => createSessionMediaMaterials(items, sessionMediaItemIds, selectedItem, isMediaSessionReset),
    [items, sessionMediaItemIds, selectedItem, isMediaSessionReset]
  );
  const selectedMedia = useMemo(
    () => mediaMaterials.find((material) => material.id === selectedMediaId) ?? mediaMaterials[0],
    [mediaMaterials, selectedMediaId]
  );
  const sourceMaterials = useMemo(
    () => mediaMaterials.filter((material) => material.importItem.provider !== "runninghub"),
    [mediaMaterials]
  );
  const generatedMaterials = useMemo(
    () => mediaMaterials.filter((material) => material.importItem.provider === "runninghub"),
    [mediaMaterials]
  );

  function appendActivityEntry(entry: Omit<ActivityLogEntry, "id" | "createdAt"> & { id?: string; createdAt?: string }) {
    setActivityEntries((current) => [
      ...current.slice(-199),
      {
        id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: entry.createdAt ?? new Date().toISOString(),
        tone: entry.tone,
        message: entry.message,
        source: entry.source
      }
    ]);
  }

  function recordStatus(nextStatus: StatusState, source = "ui") {
    setStatus(nextStatus);
    appendActivityEntry({ ...nextStatus, source });
  }

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("activity", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as ActivityLogEntry;
        const nextStatus = { tone: data.tone, message: data.message };
        setStatus(nextStatus);
        appendActivityEntry(data);
      } catch {
        appendActivityEntry({
          tone: "error",
          message: "Could not parse backend activity event.",
          source: "events"
        });
      }
    });

    return () => events.close();
  }, []);

  useEffect(() => {
    getHealth()
      .then((health) => {
        if (health.importProvider !== "apify") {
          setIsBackendCurrent(false);
          recordStatus({
            tone: "error",
            message: "Old local backend is running. Stop npm run dev and start again with ./start.sh."
          });
        } else {
          setIsBackendCurrent(true);
        }
      })
      .catch((error: unknown) => {
        setIsBackendCurrent(false);
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      });

    listImports()
      .then((loadedSession) => {
        setItems(loadedSession.items);
        setCurrentSession(loadedSession.session);
        isPromptAutosaveReadyRef.current = true;
        setPromptDocuments(mergePromptDocuments([], Object.entries(loadedSession.session.promptTexts ?? {}).map(([mediaId, prompt]) => ({ mediaId, label: mediaId, prompt }))));
        const sessionItemIds = loadedSession.session.itemIds;
        const firstSessionItem = sessionItemIds.length > 0
          ? loadedSession.items.find((item) => item.id === sessionItemIds[0])
          : undefined;
        const firstItemMedia = firstSessionItem ? createMediaMaterials(firstSessionItem) : [];
        setSelectedItemId(firstSessionItem?.id ?? null);
        setSessionMediaItemIds(sessionItemIds);
        setIsMediaSessionReset(sessionItemIds.length === 0);
        setSelectedMediaId(firstItemMedia[0]?.id ?? null);
        setSelectedForGeneration(firstItemMedia[0]?.id ? [firstItemMedia[0].id] : []);
      })
      .catch((error: unknown) => {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      });

    getConnections()
      .then((loadedConnections) => {
        setConnections(loadedConnections);
        setRunningHubWorkflows(loadedConnections.runningHubWorkflows);
        setOllamaPresets(loadedConnections.ollamaPresets);
        setStudioActionButtons(loadedConnections.studioActionButtons);
        setGenerationPrefixOptions(loadedConnections.generationPrefixOptions ?? "");
        setGenerationPrefixSelection(loadedConnections.generationPrefixSelection ?? "");
        if (loadedConnections.hasOllamaCloudApiKey) {
          void refreshOllamaModels("cloud", true);
        }
      })
      .catch((error: unknown) => {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      });

    void refreshOllamaModels("local", true);
  }, []);

  useEffect(() => {
    if (!isPromptAutosaveReadyRef.current || promptDocuments.length === 0) {
      return;
    }

    const revision = promptAutosaveRevisionRef.current;
    const prompts = createPromptTextRecord(promptDocuments);
    let retryTimeout: number | undefined;
    const attemptAutosave = () => {
      if (revision !== promptAutosaveRevisionRef.current) {
        return;
      }

      if (!tryBeginSessionMutation()) {
        retryTimeout = window.setTimeout(attemptAutosave, 100);
        return;
      }

      void saveSessionPrompts(prompts)
        .then((session) => {
          if (revision !== promptAutosaveRevisionRef.current) {
            return;
          }
          setCurrentSession(session);
          setSessionMediaItemIds(session.itemIds);
        })
        .catch((error: unknown) => {
          if (revision === promptAutosaveRevisionRef.current) {
            recordStatus({ tone: "error", message: `Could not autosave prompt locally: ${toErrorMessage(error)}` });
          }
        })
        .finally(() => {
          endSessionMutation();
        });
    };

    const timeout = window.setTimeout(attemptAutosave, 600);

    return () => {
      window.clearTimeout(timeout);
      if (retryTimeout !== undefined) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [promptDocuments]);

  async function handleImport(forceRefresh = false) {
    if (!isBackendCurrent) {
      recordStatus({
        tone: "error",
        message: "Old local backend is running. Stop npm run dev and start again with ./start.sh."
      });
      return;
    }

    const validation = validateInstagramUrl(url);
    if (!validation.ok) {
      recordStatus({ tone: "error", message: validation.message });
      return;
    }

    if (!tryBeginSessionMutation()) {
      return;
    }

    promptAutosaveRevisionRef.current += 1;
    setIsImporting(true);
    recordStatus({
      tone: "running",
      message: forceRefresh
        ? "Downloading a fresh copy with Apify. This can take a minute."
        : "Looking for previously downloaded media."
    });

    try {
      const imported = await importInstagramUrl(validation.url, { forceRefresh });
      const importedItem = imported.item;
      isPromptAutosaveReadyRef.current = true;
      setCurrentSession(imported.session);
      setPromptDocuments(mergePromptDocuments([], Object.entries(imported.session.promptTexts ?? {}).map(([mediaId, prompt]) => ({ mediaId, label: mediaId, prompt }))));
      setItems((current) => [importedItem, ...current.filter((item) => item.id !== importedItem.id)]);
      const importedMedia = createMediaMaterials(importedItem);
      setSelectedItemId(importedItem.id);
      setSessionMediaItemIds(imported.session.itemIds);
      setIsMediaSessionReset(false);
      setSelectedMediaId(importedMedia[0]?.id ?? null);
      setSelectedForGeneration(importedMedia[0]?.id ? [importedMedia[0].id] : []);
      recordStatus({
        tone: "ready",
        message: imported.reused
          ? "Using previously downloaded media."
          : importedMedia.length > 1
          ? `Import complete: ${importedMedia.length} materials added.`
          : "Import complete."
      });
      setUrl("");
      setUrlNotice(null);
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsImporting(false);
      endSessionMutation();
    }
  }

  async function handleLocalImageUpload(files: FileList | null) {
    if (!files?.length || !tryBeginSessionMutation()) return;

    promptAutosaveRevisionRef.current += 1;
    setIsImporting(true);
    try {
      const uploaded = [] as Array<Awaited<ReturnType<typeof uploadLocalImage>>>;
      for (const [index, file] of Array.from(files).entries()) {
        const imported = await uploadLocalImage(file, { appendToSession: index > 0 });
        uploaded.push(imported);

        const firstImported = uploaded[0];
        const firstImportedMedia = createMediaMaterials(firstImported.item);
        isPromptAutosaveReadyRef.current = true;
        setCurrentSession(imported.session);
        setItems((current) => [
          ...uploaded.map((item) => item.item),
          ...current.filter((item) => !uploaded.some((uploadedItem) => uploadedItem.item.id === item.id))
        ]);
        setSelectedItemId(firstImported.item.id);
        setSessionMediaItemIds(imported.session.itemIds);
        setIsMediaSessionReset(false);
        setSelectedMediaId(firstImportedMedia[0]?.id ?? null);
        setSelectedForGeneration(firstImportedMedia[0]?.id ? [firstImportedMedia[0].id] : []);
        setPromptDocuments([]);
        setUrl("");
        setUrlNotice("Локальное изображение — ссылка Instagram отсутствует");
      }

      recordStatus({ tone: "ready", message: "Local image uploaded." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      if (localImageInputRef.current) {
        localImageInputRef.current.value = "";
      }
      setIsImporting(false);
      endSessionMutation();
    }
  }

  async function handleOpenFolder() {
    try {
      await openImportsFolder();
      recordStatus({ tone: "ready", message: "Opened imports folder." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    }
  }

  async function handleResetMediaSession() {
    if (!tryBeginSessionMutation()) {
      return;
    }

    promptAutosaveRevisionRef.current += 1;
    setIsResetting(true);
    try {
      const resetSession = await resetMediaSession();
      isPromptAutosaveReadyRef.current = true;
      setCurrentSession(resetSession);
      setSessionMediaItemIds(resetSession.itemIds);
      setSelectedItemId(null);
      setSelectedMediaId(null);
      setIsMediaSessionReset(true);
      setSelectedForGeneration([]);
      setPromptDocuments([]);
      setUrl("");
      setUrlNotice(null);
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsResetting(false);
      endSessionMutation();
    }
  }

  async function createSelectedPrompts(ollamaPresetId: string, signal?: AbortSignal): Promise<Array<{ mediaId: string; label: string; prompt: string }>> {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    const documentsByMediaId = new Map(promptDocuments.map((document) => [document.mediaId, document]));
    const missingPromptMedia = selectedPromptMedia.filter((media) => !documentsByMediaId.has(media.id));
    let generatedPrompts: Array<{ mediaId: string; label: string; prompt: string }> = [];
    const prefix = parseGenerationPrefixes(generationPrefixOptions).find((item) => item.name === generationPrefixSelection)?.text;
    for (const media of missingPromptMedia) {
      const generated = await generateImagePromptsWithOptions([media], { ollamaPresetId, signal });
      const generatedPrompt = generated.prompts[0];
      if (!generatedPrompt) {
        continue;
      }
      const prompt = {
        ...generatedPrompt,
        prompt: prefix ? `${prefix}, ${generatedPrompt.prompt}` : generatedPrompt.prompt
      };
      generatedPrompts.push(prompt);
      setPromptDocuments((current) => mergePromptDocuments(current, [prompt]));
      const savedSession = await saveSessionPrompts({ [prompt.mediaId]: prompt.prompt });
      setCurrentSession(savedSession);
      setSessionMediaItemIds(savedSession.itemIds);
      setIsMediaSessionReset(false);
    }

    const promptByMediaId = new Map<string, string>([
      ...promptDocuments.map((document) => [document.mediaId, getCurrentPrompt(document)] as const),
      ...generatedPrompts.map((prompt) => [prompt.mediaId, prompt.prompt] as const)
    ]);
    return selectedPromptMedia.flatMap((media) => {
      const prompt = promptByMediaId.get(media.id);
      return prompt === undefined ? [] : [{ mediaId: media.id, label: media.label, prompt }];
    });
  }

  async function handleGenerateImagePrompts(ollamaPresetId: string) {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before prompt generation." });
      return;
    }

    if (!tryBeginSessionMutation()) {
      return;
    }

    setIsGeneratingPrompt(true);
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    recordStatus({ tone: "running", message: "Generating prompts with the selected Ollama model." });
    try {
      await createSelectedPrompts(ollamaPresetId, abortController.signal);
    } catch (error) {
      if (!isAbortError(error)) {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      }
    } finally {
      setIsGeneratingPrompt(false);
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }
      endSessionMutation();
    }
  }

  async function handleSavePrompt(mediaId: string) {
    const document = promptDocuments.find((item) => item.mediaId === mediaId);
    if (!document) {
      return;
    }

    if (!tryBeginSessionMutation()) {
      return;
    }

    setIsSavingPrompt(true);
    try {
      const session = await saveSessionPrompts({ [mediaId]: getCurrentPrompt(document) });
      setCurrentSession(session);
      setSessionMediaItemIds(session.itemIds);
      recordStatus({ tone: "ready", message: "Prompt saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingPrompt(false);
      endSessionMutation();
    }
  }

  async function handleSaveGenerationPrefixes(value: string) {
    const nextSelection = parseGenerationPrefixes(value).some((item) => item.name === generationPrefixSelection)
      ? generationPrefixSelection
      : "";

    try {
      const saved = await saveConnections({
        generationPrefixOptions: value,
        generationPrefixSelection: nextSelection
      });
      setConnections(saved);
      setGenerationPrefixOptions(value);
      setGenerationPrefixSelection(nextSelection);
      setIsEditingGenerationPrefixes(false);
      recordStatus({ tone: "ready", message: "Generation prefix options saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    }
  }

  async function handleGenerateImages(runningHubWorkflowPresetId: string) {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before image generation." });
      return;
    }

    if (!tryBeginSessionMutation()) {
      return;
    }

    setIsGeneratingImages(true);
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    recordStatus({ tone: "running", message: "Sending the current edited prompts and source images to RunningHub." });
    try {
      const promptsByMediaId = new Map(promptDocuments.map((document) => [document.mediaId, getCurrentPrompt(document)]));
      const promptImageJobs = selectedPromptMedia.flatMap((media) => {
        const prompt = promptsByMediaId.get(media.id);
        return prompt === undefined ? [] : [{ media, prompt }];
      });
      if (promptImageJobs.length !== selectedPromptMedia.length) throw new Error("Generate prompts with a text action before image generation.");
      const imageJobs = repeatImageGenerationJobs(promptImageJobs, imageGenerationsPerMedia);
      for (const [batchIndex, imageJob] of imageJobs.entries()) {
        const generated = await generateImagesWithOptions([imageJob], {
          runningHubWorkflowPresetId,
          signal: abortController.signal,
          batchPosition: batchIndex + 1,
          batchTotal: imageJobs.length
        });
        setItems((current) => [generated.item, ...current.filter((item) => item.id !== generated.item.id)]);
        const generatedMedia = createMediaMaterials(generated.item);
        setCurrentSession(generated.session);
        setSessionMediaItemIds(generated.session.itemIds);
        setIsMediaSessionReset(false);
        setSelectedForGeneration((current) => current.filter((id) => !generatedMedia.some((material) => material.id === id)));
      }
    } catch (error) {
      if (!isAbortError(error)) {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      }
    } finally {
      setIsGeneratingImages(false);
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }
      endSessionMutation();
    }
  }

  function handleCancelGeneration() {
    generationAbortControllerRef.current?.abort();
    generationAbortControllerRef.current = null;
    setIsGeneratingPrompt(false);
    setIsGeneratingImages(false);
    endSessionMutation();
    recordStatus({ tone: "ready", message: "Generation cancellation requested." });
    void cancelGeneration().catch((error: unknown) => {
      if (!isAbortError(error)) {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      }
    });
  }

  async function handleCopyStatusLog() {
    try {
      await navigator.clipboard.writeText(formatActivityLogForCopy(activityEntries));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  }

  async function handleSaveConnections() {
    setIsSavingConnections(true);
    try {
      const saved = await saveConnections({
        runningHubWorkflows,
        ollamaPresets,
        studioActionButtons,
        generationPrefixOptions,
        generationPrefixSelection
      });
      setConnections(saved);
      setRunningHubWorkflows(saved.runningHubWorkflows);
      setOllamaPresets(saved.ollamaPresets);
      setStudioActionButtons(saved.studioActionButtons);
      recordStatus({ tone: "ready", message: "Connections saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingConnections(false);
    }
  }

  function addRunningHubWorkflow() {
    setRunningHubWorkflows((current) => [...current, { id: crypto.randomUUID(), displayId: nextPresetDisplayId("RH", current), workflowId: "", bindings: [emptyRunningHubBinding] }]);
  }

  function addOllamaPreset() {
    setOllamaPresets((current) => [...current, { id: crypto.randomUUID(), displayId: nextPresetDisplayId("OL", current), provider: "local", model: "", promptInstruction: "" }]);
  }

  function updateRunningHubWorkflow(id: string, update: Partial<RunningHubWorkflowPreset>) {
    setRunningHubWorkflows((current) => current.map((workflow) => workflow.id === id ? { ...workflow, ...update } : workflow));
  }

  function updateOllamaPreset(id: string, update: Partial<OllamaPreset>) {
    setOllamaPresets((current) => current.map((preset) => preset.id === id ? { ...preset, ...update } : preset));
  }

  function addStudioAction(type: StudioActionType) {
    persistStudioActionButtons([...studioActionButtons, { id: crypto.randomUUID(), label: type === "text" ? "Генерация текста" : "Генерация изображения", type, order: studioActionButtons.length }]);
  }

  function updateStudioAction(id: string, update: Partial<StudioActionButton>) {
    persistStudioActionButtons(studioActionButtons.map((button) => button.id === id ? { ...button, ...update } : button));
  }

  function moveStudioAction(targetId: string) {
    if (draggedStudioActionId) persistStudioActionButtons(reorderStudioActionButtons(studioActionButtons, draggedStudioActionId, targetId));
    setDraggedStudioActionId(null);
  }

  function removeStudioAction(id: string) {
    persistStudioActionButtons(studioActionButtons.filter((button) => button.id !== id).map((button, order) => ({ ...button, order })));
  }

  function persistStudioActionButtons(next: StudioActionButton[]) {
    setStudioActionButtons(next);
    void saveConnections({ runningHubWorkflows, ollamaPresets, studioActionButtons: next, generationPrefixOptions, generationPrefixSelection })
      .then((saved) => {
        setConnections(saved);
        setStudioActionButtons(saved.studioActionButtons);
      })
      .catch((error: unknown) => recordStatus({ tone: "error", message: toErrorMessage(error) }));
  }

  function handleEditKey(keyName: ConnectionKeyName) {
    setEditingKey(keyName);
  }

  async function handleSaveKey(value: string) {
    if (!editingKey) {
      return;
    }

    setIsSavingKey(true);
    try {
      await saveConnectionKey(editingKey, value);
      const saved = await getConnections();
      setConnections(saved);
      setEditingKey(null);
      if (editingKey === "ollamaCloudApiKey" && value.trim()) {
        await refreshOllamaModels("cloud");
      }
      recordStatus({ tone: "ready", message: "API key saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingKey(false);
    }
  }

  async function handleClearKey(keyName: ConnectionKeyName) {
    setIsSavingKey(true);
    try {
      await clearConnectionKey(keyName);
      const saved = await getConnections();
      setConnections(saved);
      if (keyName === "ollamaCloudApiKey") {
        setCloudModels([]);
      }
      recordStatus({ tone: "ready", message: "API key cleared locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingKey(false);
    }
  }

  async function refreshOllamaModels(provider: "cloud" | "local", silently = false) {
    if (provider === "cloud") {
      setIsRefreshingCloudModels(true);
    } else {
      setIsRefreshingLocalModels(true);
    }

    try {
      const models = await listOllamaModels(provider);
      const names = models.map((model) => model.name);
      if (provider === "cloud") {
        setCloudModels(names);
      } else {
        setLocalModels(names);
      }
      if (!silently) {
        recordStatus({ tone: "ready", message: `Updated ${provider === "cloud" ? "Ollama Cloud" : "local Ollama"} model list.` });
      }
    } catch (error) {
      if (!silently) {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      }
    } finally {
      if (provider === "cloud") {
        setIsRefreshingCloudModels(false);
      } else {
        setIsRefreshingLocalModels(false);
      }
    }
  }

  return (
    <main className="app-shell">
      <nav className="app-tabs" aria-label="App sections">
        <button
          className={activeTab === "studio" ? "active" : ""}
          onClick={() => setActiveTab("studio")}
          type="button"
        >
          Студия
        </button>
        <button
          className={activeTab === "connections" ? "active" : ""}
          onClick={() => setActiveTab("connections")}
          type="button"
        >
          Настройки
        </button>
        {activeTab === "studio" ? (
          <button
            className="reset-session-button"
            disabled={isSessionMutationBusy}
            onClick={handleResetMediaSession}
            type="button"
          >
            Сброс
          </button>
        ) : null}
      </nav>

      {activeTab === "studio" ? (
        <>
          <section className="top-bar">
            <input
              className="url-input"
              disabled={isSessionMutationBusy}
              onChange={(event) => {
                setUrlNotice(null);
                setUrl(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isSessionMutationBusy) {
                  void handleImport();
                }
              }}
              placeholder="https://www.instagram.com/reel/..."
              value={urlNotice ?? url}
            />
            <button
              className="primary-button"
              disabled={isSessionMutationBusy || !isBackendCurrent}
              onClick={() => void handleImport()}
              type="button"
            >
              {isImporting ? "Importing" : "Import"}
            </button>
            <button
              className="secondary-button"
              disabled={isSessionMutationBusy || !isBackendCurrent}
              onClick={() => void handleImport(true)}
              type="button"
            >
              Обновить заново
            </button>
            <label className="secondary-button upload-image-button">
              Загрузить изображение
              <input accept="image/*" disabled={isSessionMutationBusy} multiple onChange={(event) => void handleLocalImageUpload(event.target.files)} ref={localImageInputRef} type="file" />
            </label>
            <button className="secondary-button" onClick={handleOpenFolder} type="button">Open Folder</button>
          </section>

          <section className="workspace">
            <section className="preview-panel">
              <Preview
                generationPrefixOptions={generationPrefixOptions}
                generationPrefixSelection={generationPrefixSelection}
                imageGenerationsPerMedia={imageGenerationsPerMedia}
                ollamaPresets={ollamaPresets}
                runningHubWorkflows={runningHubWorkflows}
                studioActionButtons={studioActionButtons}
                onChangePrefix={setGenerationPrefixSelection}
                onChangeImageGenerationsPerMedia={setImageGenerationsPerMedia}
                onEditPrefixes={() => setIsEditingGenerationPrefixes(true)}
                isSessionMutationBusy={isSessionMutationBusy}
                isGeneratingPrompt={isGeneratingPrompt}
                isGeneratingImages={isGeneratingImages}
                onGenerateImages={handleGenerateImages}
                onGenerateImagePrompts={handleGenerateImagePrompts}
                onAddStudioAction={addStudioAction}
                onUpdateStudioAction={updateStudioAction}
                onRemoveStudioAction={removeStudioAction}
                onDragStudioAction={setDraggedStudioActionId}
                onDropStudioAction={moveStudioAction}
                onCancelGeneration={handleCancelGeneration}
                onSavePrompt={handleSavePrompt}
                onSelectMaterial={(material) => {
                  setSelectedItemId(material.importItem.id);
                  setSelectedMediaId(material.id);
                }}
                onToggleMaterial={(materialId) => setSelectedForGeneration((current) => toggleMediaSelection(current, materialId))}
                promptDocuments={promptDocuments}
                selectedForGeneration={selectedForGeneration}
                sourceMaterials={sourceMaterials}
                generatedMaterials={generatedMaterials}
                materials={mediaMaterials}
                selected={selectedMedia}
                selectedForGenerationCount={selectedForGeneration.length}
                setSelectedForGeneration={setSelectedForGeneration}
                setPromptDocuments={setPromptDocuments}
              />
            </section>
          </section>

          {isEditingGenerationPrefixes ? <GenerationPrefixDialog onClose={() => setIsEditingGenerationPrefixes(false)} onSave={handleSaveGenerationPrefixes} savedValue={generationPrefixOptions} /> : null}

          <LogPanel
            copyState={copyState}
            entries={activityEntries}
            onCopyStatusLog={handleCopyStatusLog}
            status={status}
          />
        </>
      ) : (
        <section className="connections-page">
          <div className="panel-label">Настройки</div>
          <div className="connection-card apify-card">
            <div>
              <h2>Apify</h2>
              <KeyStatus hasKey={connections.hasApifyApiToken} preview={connections.apifyApiTokenPreview} />
            </div>
            <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("apifyApiToken")} onEdit={() => handleEditKey("apifyApiToken")} />
          </div>
          <div className="connection-card ollama-card">
            <div className="ollama-settings">
              <div className="preset-card-header"><h2>Ollama</h2></div>
              <KeyStatus hasKey={connections.hasOllamaCloudApiKey === true} preview={connections.ollamaCloudApiKeyPreview} />
              <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("ollamaCloudApiKey")} onEdit={() => handleEditKey("ollamaCloudApiKey")} />
            </div>
            <div className="preset-card-list">{ollamaPresets.map((preset) => <section className="preset-card ollama-preset-layout" key={preset.id}><div className="preset-card-header"><h3>{preset.displayId}</h3><button onClick={() => setOllamaPresets((current) => current.filter((item) => item.id !== preset.id))} type="button">−</button></div><div className="ollama-preset-settings"><div className="provider-toggle"><button className={preset.provider === "cloud" ? "active" : ""} onClick={() => updateOllamaPreset(preset.id, { provider: "cloud", model: "" })} type="button">Ollama Cloud</button><button className={preset.provider === "local" ? "active" : ""} onClick={() => updateOllamaPreset(preset.id, { provider: "local", model: "" })} type="button">Локальная Ollama</button></div><label><span>Модель</span><div className="model-control"><select disabled={preset.provider === "cloud" && !connections.hasOllamaCloudApiKey} onChange={(event) => updateOllamaPreset(preset.id, { model: event.target.value })} value={preset.model}><option value="">Выберите модель</option>{(preset.provider === "cloud" ? cloudModels : localModels).map((model) => <option key={model} value={model}>{model}</option>)}</select><button onClick={() => void refreshOllamaModels(preset.provider)} type="button">↻</button></div></label></div><label className="instruction-control ollama-preset-instruction"><span>Промт для генерации</span><textarea onChange={(event) => updateOllamaPreset(preset.id, { promptInstruction: event.target.value })} rows={8} value={preset.promptInstruction} /></label></section>)}</div>
            <div className="preset-add-row"><button className="secondary-button preset-add-button" onClick={addOllamaPreset} type="button">＋ Добавить Ollama</button></div>
          </div>
          <div className="connection-card runninghub-card">
            <div className="preset-card-header">
              <div><h2>RunningHub ComfyUI</h2>
              <KeyStatus hasKey={connections.hasRunningHubApiKey} preview={connections.runningHubApiKeyPreview} />
              </div></div>
            <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("runningHubApiKey")} onEdit={() => handleEditKey("runningHubApiKey")} />
            <div className="preset-card-list">{runningHubWorkflows.map((workflow) => {
              const editableBindings = getEditableRunningHubBindings(workflow.bindings);
              return <section className="preset-card" key={workflow.id}><div className="preset-card-header"><h3>{workflow.displayId}</h3><button onClick={() => setRunningHubWorkflows((current) => current.filter((item) => item.id !== workflow.id))} type="button">−</button></div><label><span>Workflow ID</span><input className="secret-input" onChange={(event) => updateRunningHubWorkflow(workflow.id, { workflowId: event.target.value })} value={workflow.workflowId} /></label><div className="runninghub-bindings"><div className="runninghub-bindings-title">Workflow bindings</div>{editableBindings.map((binding, index) => <div className="runninghub-binding-row" key={`${workflow.id}-${index}`}><label><span>Node ID</span><input className="secret-input" onChange={(event) => updateRunningHubWorkflow(workflow.id, { bindings: editableBindings.map((item, itemIndex) => itemIndex === index ? { ...item, nodeId: event.target.value } : item) })} value={binding.nodeId} /></label><label><span>Field</span><input className="secret-input" onChange={(event) => updateRunningHubWorkflow(workflow.id, { bindings: editableBindings.map((item, itemIndex) => itemIndex === index ? { ...item, fieldName: event.target.value } : item) })} value={binding.fieldName} /></label><label><span>Studio ID</span><select onChange={(event) => updateRunningHubWorkflow(workflow.id, { bindings: editableBindings.map((item, itemIndex) => itemIndex === index ? { ...item, studioId: event.target.value as RunningHubBinding["studioId"] } : item) })} value={binding.studioId}>{studioIds.map((studioId) => <option key={studioId} value={studioId}>{getStudioIdLabel(studioId)}</option>)}</select></label><button className="binding-icon-button" onClick={() => updateRunningHubWorkflow(workflow.id, { bindings: [...editableBindings, emptyRunningHubBinding] })} type="button">+</button><button className="binding-icon-button" onClick={() => updateRunningHubWorkflow(workflow.id, { bindings: editableBindings.length === 1 ? [emptyRunningHubBinding] : editableBindings.filter((_, itemIndex) => itemIndex !== index) })} type="button">−</button></div>)}</div></section>;
            })}</div>
            <div className="preset-add-row"><button className="secondary-button preset-add-button" onClick={addRunningHubWorkflow} type="button">＋ Добавить workflow</button></div>
          </div>
          <button
            className="primary-button save-connections-button"
            disabled={isSavingConnections}
            onClick={handleSaveConnections}
            type="button"
          >
            {isSavingConnections ? "Saving" : "Save"}
          </button>
          <div className="connection-note">
            Ключ хранится только в локальном data/connections.local.json с закрытыми правами доступа и не загружается обратно в браузер.
          </div>
          {editingKey ? <KeyEditDialog integration={getIntegrationName(editingKey)} isSaving={isSavingKey} onClose={() => setEditingKey(null)} onSave={handleSaveKey} /> : null}
        </section>
      )}
    </main>
  );
}

function Preview({
  generationPrefixOptions,
  generationPrefixSelection,
  imageGenerationsPerMedia,
  ollamaPresets,
  runningHubWorkflows,
  studioActionButtons,
  onChangePrefix,
  onChangeImageGenerationsPerMedia,
  onEditPrefixes,
  isSessionMutationBusy,
  isGeneratingPrompt,
  isGeneratingImages,
  onGenerateImages,
  onGenerateImagePrompts,
  onAddStudioAction,
  onUpdateStudioAction,
  onRemoveStudioAction,
  onDragStudioAction,
  onDropStudioAction,
  onCancelGeneration,
  onSavePrompt,
  onSelectMaterial,
  onToggleMaterial,
  promptDocuments,
  selectedForGeneration,
  selectedForGenerationCount,
  selected,
  sourceMaterials,
  generatedMaterials,
  materials,
  setSelectedForGeneration,
  setPromptDocuments
}: {
  generationPrefixOptions: string;
  generationPrefixSelection: string;
  imageGenerationsPerMedia: number;
  ollamaPresets: OllamaPreset[];
  runningHubWorkflows: RunningHubWorkflowPreset[];
  studioActionButtons: StudioActionButton[];
  onChangePrefix: (value: string) => void;
  onChangeImageGenerationsPerMedia: (value: number) => void;
  onEditPrefixes: () => void;
  isSessionMutationBusy: boolean;
  isGeneratingPrompt: boolean;
  isGeneratingImages: boolean;
  onGenerateImages: (presetId: string) => void;
  onGenerateImagePrompts: (presetId: string) => void;
  onAddStudioAction: (type: StudioActionType) => void;
  onUpdateStudioAction: (id: string, update: Partial<StudioActionButton>) => void;
  onRemoveStudioAction: (id: string) => void;
  onDragStudioAction: (id: string | null) => void;
  onDropStudioAction: (id: string) => void;
  onCancelGeneration: () => void;
  onSavePrompt: (mediaId: string) => void;
  onSelectMaterial: (material: MediaMaterial) => void;
  onToggleMaterial: (materialId: string) => void;
  promptDocuments: PromptDocument[];
  selectedForGeneration: string[];
  selectedForGenerationCount: number;
  selected?: MediaMaterial;
  sourceMaterials: MediaMaterial[];
  generatedMaterials: MediaMaterial[];
  materials: MediaMaterial[];
  setSelectedForGeneration: React.Dispatch<React.SetStateAction<string[]>>;
  setPromptDocuments: React.Dispatch<React.SetStateAction<PromptDocument[]>>;
}) {
  const imageSource = selected?.files.image ?? selected?.files.firstFrame ?? selected?.files.thumbnail;

  return (
    <div className="preview-content">
      <div className="preview-main">
        <div className="preview-column"><div className="panel-label">Preview</div>
        <div className="media-stage">
          {selected?.files.video ? (
            <video controls poster={selected.files.firstFrame ?? selected.files.thumbnail} src={selected.files.video} />
          ) : imageSource && selected ? (
            <img alt={selected.importItem.title ?? "Imported Instagram media"} src={imageSource} />
          ) : selected ? (
            <div className="preview-empty">No preview file was generated for this import.</div>
          ) : null}
        </div>
        </div>
        <div className="media-column">
          <div className="panel-label">Media</div>
          <MediaSelector materials={sourceMaterials} onSelect={onSelectMaterial} onSelectAll={() => setSelectedForGeneration((current) => toggleAllMediaSelection(current, sourceMaterials.map((material) => material.id)))} onToggle={onToggleMaterial} selected={selected} selectedForGeneration={selectedForGeneration} />
        </div>
        <div className="media-column generated-media-column">
          <div className="panel-label">Generated Media</div>
          <MediaSelector materials={generatedMaterials} onSelect={onSelectMaterial} onSelectAll={() => setSelectedForGeneration((current) => toggleAllMediaSelection(current, generatedMaterials.map((material) => material.id)))} onToggle={onToggleMaterial} selected={selected} selectedForGeneration={selectedForGeneration} />
        </div>
        <GenerationWorkspace
          generationPrefixOptions={generationPrefixOptions}
          generationPrefixSelection={generationPrefixSelection}
          imageGenerationsPerMedia={imageGenerationsPerMedia}
          ollamaPresets={ollamaPresets}
          runningHubWorkflows={runningHubWorkflows}
          studioActionButtons={studioActionButtons}
          onChangePrefix={onChangePrefix}
          onChangeImageGenerationsPerMedia={onChangeImageGenerationsPerMedia}
          onEditPrefixes={onEditPrefixes}
          isSessionMutationBusy={isSessionMutationBusy}
          isGeneratingImages={isGeneratingImages}
          isGeneratingPrompt={isGeneratingPrompt}
          onGenerateImages={onGenerateImages}
          onGenerateImagePrompts={onGenerateImagePrompts}
          onAddStudioAction={onAddStudioAction}
          onUpdateStudioAction={onUpdateStudioAction}
          onRemoveStudioAction={onRemoveStudioAction}
          onDragStudioAction={onDragStudioAction}
          onDropStudioAction={onDropStudioAction}
          onCancelGeneration={onCancelGeneration}
          selectedForGenerationCount={selectedForGenerationCount}
        />
      </div>
      <PromptEditors
        documents={promptDocuments.filter((document) => selectedForGeneration.includes(document.mediaId))}
        isBusy={isSessionMutationBusy}
        materials={materials.filter((material) => selectedForGeneration.includes(material.id))}
        onEdit={(mediaId, value) => setPromptDocuments((current) => editPromptDocument(current, mediaId, value))}
        onRedo={(mediaId) => setPromptDocuments((current) => redoPromptDocument(current, mediaId))}
        onReset={(mediaId) => setPromptDocuments((current) => resetPromptDocument(current, mediaId))}
        onSave={onSavePrompt}
        onUndo={(mediaId) => setPromptDocuments((current) => undoPromptDocument(current, mediaId))}
      />
    </div>
  );
}

function parseGenerationPrefixes(value: string): Array<{ name: string; text: string }> {
  return value.split("\n").flatMap((line) => {
    const separator = line.indexOf(";");
    if (separator < 1 || !line.slice(separator + 1).trim()) return [];
    return [{ name: line.slice(0, separator).trim(), text: line.slice(separator + 1).trim() }];
  });
}

function GenerationWorkspace({
  generationPrefixOptions,
  generationPrefixSelection,
  imageGenerationsPerMedia,
  ollamaPresets,
  runningHubWorkflows,
  studioActionButtons,
  onChangePrefix,
  onChangeImageGenerationsPerMedia,
  onEditPrefixes,
  isSessionMutationBusy,
  isGeneratingImages,
  isGeneratingPrompt,
  onGenerateImages,
  onGenerateImagePrompts,
  onAddStudioAction,
  onUpdateStudioAction,
  onRemoveStudioAction,
  onDragStudioAction,
  onDropStudioAction,
  onCancelGeneration,
  selectedForGenerationCount
}: {
  generationPrefixOptions: string;
  generationPrefixSelection: string;
  imageGenerationsPerMedia: number;
  ollamaPresets: OllamaPreset[];
  runningHubWorkflows: RunningHubWorkflowPreset[];
  studioActionButtons: StudioActionButton[];
  onChangePrefix: (value: string) => void;
  onChangeImageGenerationsPerMedia: (value: number) => void;
  onEditPrefixes: () => void;
  isSessionMutationBusy: boolean;
  isGeneratingImages: boolean;
  isGeneratingPrompt: boolean;
  onGenerateImages: (presetId: string) => void;
  onGenerateImagePrompts: (presetId: string) => void;
  onAddStudioAction: (type: StudioActionType) => void;
  onUpdateStudioAction: (id: string, update: Partial<StudioActionButton>) => void;
  onRemoveStudioAction: (id: string) => void;
  onDragStudioAction: (id: string | null) => void;
  onDropStudioAction: (id: string) => void;
  onCancelGeneration: () => void;
  selectedForGenerationCount: number;
}) {
  const imageGenerationCount = selectedForGenerationCount * imageGenerationsPerMedia;

  return (
    <div className="generation-column">
      <div className="panel-label">Generation workspace</div>
      <aside className="generation-panel">
        <div className="generation-prefix-control">
          <select onChange={(event) => onChangePrefix(event.target.value)} value={generationPrefixSelection}>
            <option value="">Не выбрано</option>
            {parseGenerationPrefixes(generationPrefixOptions).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
          <button aria-label="Редактировать варианты промта" onClick={onEditPrefixes} type="button">✎</button>
        </div>
        <div className="studio-action-add">
          <button disabled={isSessionMutationBusy} onClick={() => onAddStudioAction("text")} type="button">＋ Текст</button>
          <button disabled={isSessionMutationBusy} onClick={() => onAddStudioAction("image")} type="button">＋ Изображение</button>
        </div>
        <div className="studio-action-list">
          {studioActionButtons.map((action) => {
            const presets = action.type === "text" ? ollamaPresets : runningHubWorkflows;
            const ready = Boolean(action.presetId && presets.some((preset) => preset.id === action.presetId));
            return <div className={`studio-action-button studio-action-${action.type}`} draggable={true} key={action.id} onDragEnd={() => onDragStudioAction(null)} onDragOver={(event) => event.preventDefault()} onDragStart={() => onDragStudioAction(action.id)} onDrop={() => onDropStudioAction(action.id)}>
              <button disabled={isSessionMutationBusy || selectedForGenerationCount === 0 || !ready} onClick={() => action.presetId && (action.type === "text" ? onGenerateImagePrompts(action.presetId) : onGenerateImages(action.presetId))} type="button">{action.type === "text" ? (isGeneratingPrompt ? "Generating" : `Generate prompt (${selectedForGenerationCount})`) : (isGeneratingImages ? "Generating" : `Image generation (${imageGenerationCount})`)}</button>
              <select aria-label={action.type === "text" ? "Workflow Ollama" : "Workflow RunningHub"} className="studio-action-select studio-workflow-select" onChange={(event) => onUpdateStudioAction(action.id, { presetId: event.target.value || undefined })} value={action.presetId ?? ""}>
                <option value="">□</option>
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.displayId}</option>)}
              </select>
              {action.type === "image" ? <select aria-label="Количество генераций на изображение" className="studio-action-select" onChange={(event) => onChangeImageGenerationsPerMedia(Number(event.target.value))} value={imageGenerationsPerMedia}>{Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select> : null}
              <button className="studio-action-remove" onClick={() => onRemoveStudioAction(action.id)} type="button">−</button>
            </div>;
          })}
        </div>
        <button onClick={onCancelGeneration} type="button">Отмена</button>
      </aside>
    </div>
  );
}

function MediaSelector({
  materials,
  onSelect,
  onSelectAll,
  onToggle,
  selected,
  selectedForGeneration
}: {
  materials: MediaMaterial[];
  onSelect: (material: MediaMaterial) => void;
  onSelectAll: () => void;
  onToggle: (materialId: string) => void;
  selected?: MediaMaterial;
  selectedForGeneration: string[];
}) {
  const hasEveryMaterialSelected = materials.length > 0 && materials.every((material) => selectedForGeneration.includes(material.id));

  return (
    <aside className="media-selector">
      <div className="media-list">
        {materials.map((material) => (
          <div className={["gallery-item", material.id === selected?.id ? "selected" : "", selectedForGeneration.includes(material.id) ? "queued" : ""].filter(Boolean).join(" ")} key={material.id}>
            <button className="gallery-preview" onClick={() => onSelect(material)} type="button">
              <GalleryThumb material={material} />
              <span>{material.label}</span>
            </button>
            <label className="gallery-select">
              <input checked={selectedForGeneration.includes(material.id)} onChange={() => onToggle(material.id)} type="checkbox" />
              Use
            </label>
          </div>
        ))}
      </div>
      <button onClick={onSelectAll} type="button">{hasEveryMaterialSelected ? "Снять выделение" : "Выбрать все"}</button>
    </aside>
  );
}

function PromptEditors({
  documents,
  isBusy,
  materials,
  onEdit,
  onRedo,
  onReset,
  onSave,
  onUndo
}: {
  documents: PromptDocument[];
  isBusy: boolean;
  materials: MediaMaterial[];
  onEdit: (mediaId: string, value: string) => void;
  onRedo: (mediaId: string) => void;
  onReset: (mediaId: string) => void;
  onSave: (mediaId: string) => void;
  onUndo: (mediaId: string) => void;
}) {
  const materialById = new Map(materials.map((material) => [material.id, material]));

  if (documents.length === 0) {
    return <section className="prompt-editors prompt-editors-empty">Сгенерированные промты для выбранных Media появятся здесь.</section>;
  }

  return (
    <section className="prompt-editors" aria-label="Сгенерированные промты">
      {documents.map((document) => (
        <article className="prompt-editor-card" key={document.mediaId}>
          <div className="prompt-editor-header">
            <strong>Промт: {materialById.get(document.mediaId)?.label ?? document.label}</strong>
            <div className="prompt-editor-actions">
              <button aria-label="Отменить изменение промта" disabled={isBusy || document.historyIndex === 0} onClick={() => onUndo(document.mediaId)} type="button">↶</button>
               <button aria-label="Повторить изменение промта" disabled={isBusy || document.historyIndex === document.history.length - 1} onClick={() => onRedo(document.mediaId)} type="button">↷</button>
               <button aria-label="Сбросить изменения промта" disabled={isBusy} onClick={() => onReset(document.mediaId)} type="button">↺</button>
               <button disabled={isBusy} onClick={() => onSave(document.mediaId)} type="button">Сохранить</button>
            </div>
          </div>
          <textarea disabled={isBusy} rows={8} value={getCurrentPrompt(document)} onChange={(event) => onEdit(document.mediaId, event.target.value)} />
        </article>
      ))}
    </section>
  );
}

function KeyStatus({ hasKey, preview }: { hasKey: boolean; preview?: string }) {
  return <p>{hasKey ? `Ключ сохранен локально: ${preview}` : "Ключ не сохранен."}</p>;
}

function KeyActions({ disabled, onClear, onEdit }: { disabled: boolean; onClear: () => void; onEdit: () => void }) {
  return <div className="key-actions"><button disabled={disabled} onClick={onEdit} type="button">Вставить ключ</button><button disabled={disabled} onClick={onClear} type="button">Очистить</button></div>;
}

function KeyEditDialog({
  integration,
  isSaving,
  onSave,
  onClose
}: {
  integration: string;
  isSaving: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="key-dialog-backdrop" role="presentation">
      <section aria-label={`API key: ${integration}`} className="key-dialog" role="dialog" aria-modal="true">
        <h2>{integration}: API key</h2>
        <p>Введите новый ключ. Сохранённое значение не загружается в браузер.</p>
        <input autoComplete="new-password" autoFocus onChange={(event) => setValue(event.target.value)} type="password" value={value} />
        <div className="key-actions"><button disabled={isSaving || !value.trim()} onClick={() => onSave(value)} type="button">Сохранить</button><button disabled={isSaving} onClick={onClose} type="button">Отмена</button></div>
      </section>
    </div>
  );
}

function GenerationPrefixDialog({
  savedValue,
  onSave,
  onClose
}: {
  savedValue: string;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(savedValue);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    await onSave(value);
    setIsSaving(false);
  }

  return (
    <div className="key-dialog-backdrop" role="presentation">
      <section aria-label="Варианты подстановки" className="key-dialog generation-prefix-dialog" role="dialog" aria-modal="true">
        <h2>Варианты подстановки</h2>
        <p>Название;Текст — одна строка на вариант</p>
        <textarea autoFocus onChange={(event) => setValue(event.target.value)} rows={12} value={value} />
        <div className="key-actions"><button disabled={isSaving} onClick={() => void handleSave()} type="button">Сохранить</button><button disabled={isSaving} onClick={onClose} type="button">Отмена</button></div>
      </section>
    </div>
  );
}

function getIntegrationName(keyName: ConnectionKeyName): string {
  if (keyName === "apifyApiToken") {
    return "Apify";
  }
  if (keyName === "ollamaCloudApiKey") {
    return "Ollama Cloud";
  }
  return "RunningHub";
}

function getStudioIdLabel(studioId: RunningHubBinding["studioId"]): string {
  if (studioId === "1") return "1 · Source image";
  if (studioId === "2") return "2 · Prompt";
  if (studioId === "3") return "3 · Source video";
  return "4 · Generated image";
}

function LogPanel({
  copyState,
  entries,
  onCopyStatusLog,
  status
}: {
  copyState: "idle" | "copied" | "failed";
  entries: ActivityLogEntry[];
  onCopyStatusLog: () => void;
  status: StatusState;
}) {
  const logFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logFeedRef.current) {
      logFeedRef.current.scrollTop = logFeedRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <aside className={`log-panel status-${status.tone}`}>
      <div className="log-panel-header">
        <span>Log</span>
        <button className="copy-log-button" onClick={onCopyStatusLog} type="button">
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : "Copy"}
        </button>
      </div>
      <div className="log-panel-status">{status.tone}</div>
      <div className="log-panel-feed" ref={logFeedRef}>
        {entries.map((entry) => (
          <article className={`log-entry status-${entry.tone}`} key={entry.id}>
            <div className="log-entry-meta">
              <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
              <span>{entry.source ?? "app"}</span>
              <span>{entry.tone}</span>
            </div>
            <pre>{entry.message}</pre>
          </article>
        ))}
      </div>
    </aside>
  );
}

function GalleryThumb({ material }: { material: MediaMaterial }) {
  const source = material.files.thumbnail ?? material.files.image ?? material.files.firstFrame;

  if (source) {
    return <img alt="" src={source} />;
  }

  return <span className="gallery-fallback">{material.mediaType.slice(0, 1).toUpperCase()}</span>;
}

function getSceneForMaterial(material: MediaMaterial, currentSession: CurrentMediaSession): SceneBible | undefined {
  const sceneId = currentSession.mediaSceneMap[material.id];
  return currentSession.sceneBibles.find((scene) => scene.id === sceneId);
}

function createPromptMediaInput(material: MediaMaterial, currentSession: CurrentMediaSession): PromptMediaInput | undefined {
  const imagePath = material.files.image ?? material.files.firstFrame ?? material.files.thumbnail;
  if (!imagePath) {
    return undefined;
  }

  const sceneBible = getSceneForMaterial(material, currentSession);
  return {
    id: material.id,
    label: material.label,
    imagePath,
    ...(material.files.video ? { videoPath: material.files.video } : {}),
    ...(material.importItem.provider === "runninghub" ? { generatedImagePath: imagePath } : {}),
    sourceKind: material.importItem.mediaType === "video" || material.label === "First frame"
      ? "video-first-frame"
      : "photo",
    caption: material.importItem.caption,
    sceneBibleId: sceneBible?.id,
    sceneBible
  };
}

function createSelectedPromptMedia(
  mediaMaterials: MediaMaterial[],
  selectedForGeneration: string[],
  currentSession: CurrentMediaSession
): PromptMediaInput[] {
  return mediaMaterials
    .filter((material) => selectedForGeneration.includes(material.id))
    .map((material) => createPromptMediaInput(material, currentSession))
    .filter((material): material is PromptMediaInput => Boolean(material));
}

function repeatImageGenerationJobs<T>(jobs: T[], count: number): T[] {
  return jobs.flatMap((job) => Array.from({ length: count }, () => job));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatActivityLogForCopy(entries: ActivityLogEntry[]): string {
  return entries
    .map((entry) => {
      const source = entry.source ? ` [${entry.source}]` : "";
      return `${new Date(entry.createdAt).toLocaleString()}${source} ${createStatusLogText(entry.tone, entry.message)}`;
    })
    .join("\n\n");
}
