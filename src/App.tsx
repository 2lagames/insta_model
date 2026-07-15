import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkInstagramUrl,
  clearConnectionKey,
  generateImagePrompts,
  generateImages,
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
import { toggleMediaSelection } from "./lib/mediaSelection";
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
  const [isChecking, setIsChecking] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isBackendCurrent, setIsBackendCurrent] = useState(true);
  const [selectedForGeneration, setSelectedForGeneration] = useState<string[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [connections, setConnections] = useState<PublicConnections>({
    hasScrapeCreatorsApiKey: false,
    hasRunningHubApiKey: false
  });
  const [editingKey, setEditingKey] = useState<ConnectionKeyName | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [runningHubWorkflowId, setRunningHubWorkflowId] = useState("");
  const [runningHubPromptNodeId, setRunningHubPromptNodeId] = useState("");
  const [runningHubPromptFieldName, setRunningHubPromptFieldName] = useState("text");
  const [runningHubImageNodeId, setRunningHubImageNodeId] = useState("");
  const [runningHubImageFieldName, setRunningHubImageFieldName] = useState("image");
  const [ollamaProvider, setOllamaProvider] = useState<"cloud" | "local">("local");
  const [ollamaCloudModel, setOllamaCloudModel] = useState("");
  const [ollamaLocalModel, setOllamaLocalModel] = useState("");
  const [ollamaPromptInstruction, setOllamaPromptInstruction] = useState("");
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
        if (health.importProvider !== "scrapecreators") {
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
        setRunningHubWorkflowId(loadedConnections.runningHubWorkflowId ?? "");
        setRunningHubPromptNodeId(loadedConnections.runningHubPromptNodeId ?? "");
        setRunningHubPromptFieldName(loadedConnections.runningHubPromptFieldName ?? "");
        setRunningHubImageNodeId(loadedConnections.runningHubImageNodeId ?? "");
        setRunningHubImageFieldName(loadedConnections.runningHubImageFieldName ?? "");
        setOllamaProvider(loadedConnections.ollamaProvider ?? "local");
        setOllamaCloudModel(loadedConnections.ollamaCloudModel ?? "");
        setOllamaLocalModel(loadedConnections.ollamaLocalModel ?? "");
        setOllamaPromptInstruction(loadedConnections.ollamaPromptInstruction ?? "");
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
    const timeout = window.setTimeout(() => {
      if (revision !== promptAutosaveRevisionRef.current) {
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
        });
    }, 600);

    return () => window.clearTimeout(timeout);
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

    promptAutosaveRevisionRef.current += 1;
    setIsImporting(true);
    recordStatus({
      tone: "running",
      message: forceRefresh
        ? "Downloading a fresh copy with ScrapeCreators API. This can take a minute."
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
    }
  }

  async function handleCheckImport() {
    const validation = validateInstagramUrl(url);
    if (!validation.ok) {
      recordStatus({ tone: "error", message: validation.message });
      return;
    }

    setIsChecking(true);
    recordStatus({ tone: "running", message: "Checking ScrapeCreators access for this link." });
    try {
      const result = await checkInstagramUrl(validation.url);
      recordStatus({
        tone: result.ok ? "ready" : "error",
        message: result.ok
          ? `ScrapeCreators can access this link: ${result.sourceUrl}`
          : result.error ?? "ScrapeCreators cannot access this link."
      });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsChecking(false);
    }
  }

  async function handleLocalImageUpload(files: FileList | null) {
    if (!files?.length) return;

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
        setSelectedForGeneration([]);
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
    promptAutosaveRevisionRef.current += 1;
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
    }
  }

  async function createSelectedPrompts(): Promise<Array<{ mediaId: string; label: string; prompt: string }>> {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    const documentsByMediaId = new Map(promptDocuments.map((document) => [document.mediaId, document]));
    const missingPromptMedia = selectedPromptMedia.filter((media) => !documentsByMediaId.has(media.id));
    const savedConnections = await saveConnections({
      ollamaProvider,
      ollamaCloudModel,
      ollamaLocalModel,
      ollamaPromptInstruction,
      generationPrefixOptions,
      generationPrefixSelection
    });
    setConnections(savedConnections);

    let generatedPrompts: Array<{ mediaId: string; label: string; prompt: string }> = [];
    if (missingPromptMedia.length > 0) {
      const generated = await generateImagePrompts(missingPromptMedia);
      const prefix = parseGenerationPrefixes(generationPrefixOptions).find((item) => item.name === generationPrefixSelection)?.text;
      generatedPrompts = generated.prompts.map((item) => ({
        ...item,
        prompt: prefix ? `${prefix}, ${item.prompt}` : item.prompt
      }));
      setPromptDocuments((current) => mergePromptDocuments(current, generatedPrompts));
      setCurrentSession(generated.session);
      setSessionMediaItemIds(generated.session.itemIds);
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

  async function handleGenerateImagePrompts() {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before prompt generation." });
      return;
    }

    setIsGeneratingPrompt(true);
    recordStatus({ tone: "running", message: "Generating prompts with the selected Ollama model." });
    try {
      const selectedPrompts = await createSelectedPrompts();
      const savedSession = await saveSessionPrompts(Object.fromEntries(selectedPrompts.map((prompt) => [prompt.mediaId, prompt.prompt])));
      setCurrentSession(savedSession);
      setSessionMediaItemIds(savedSession.itemIds);
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsGeneratingPrompt(false);
    }
  }

  async function handleSavePrompt(mediaId: string) {
    const document = promptDocuments.find((item) => item.mediaId === mediaId);
    if (!document) {
      return;
    }

    try {
      const session = await saveSessionPrompts({ [mediaId]: getCurrentPrompt(document) });
      setCurrentSession(session);
      setSessionMediaItemIds(session.itemIds);
      recordStatus({ tone: "ready", message: "Prompt saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
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

  async function handleGenerateImages() {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);
    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before image generation." });
      return;
    }

    setIsGeneratingImages(true);
    recordStatus({ tone: "running", message: "Sending the current edited prompts and source images to RunningHub." });
    try {
      const selectedPrompts = await createSelectedPrompts();
      const promptsByMediaId = new Map(selectedPrompts.map((prompt) => [prompt.mediaId, prompt.prompt]));
      const imageJobs = selectedPromptMedia.flatMap((media) => {
        const prompt = promptsByMediaId.get(media.id);
        return prompt === undefined ? [] : [{ media, prompt }];
      });
      const savedSession = await saveSessionPrompts(Object.fromEntries(selectedPrompts.map((prompt) => [prompt.mediaId, prompt.prompt])));
      setCurrentSession(savedSession);
      setSessionMediaItemIds(savedSession.itemIds);
      const generated = await generateImages(imageJobs);
      setItems((current) => [generated.item, ...current.filter((item) => item.id !== generated.item.id)]);
      const generatedMedia = createMediaMaterials(generated.item);
      setCurrentSession(generated.session);
      setSessionMediaItemIds(generated.session.itemIds);
      setIsMediaSessionReset(false);
      setSelectedForGeneration((current) => current.filter((id) => !generatedMedia.some((material) => material.id === id)));
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsGeneratingImages(false);
    }
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
        ollamaProvider,
        ollamaCloudModel,
        ollamaLocalModel,
        ollamaPromptInstruction,
        runningHubWorkflowId,
        runningHubPromptNodeId,
        runningHubPromptFieldName,
        runningHubImageNodeId,
        runningHubImageFieldName
      });
      setConnections(saved);
      setRunningHubWorkflowId(saved.runningHubWorkflowId ?? "");
      setRunningHubPromptNodeId(saved.runningHubPromptNodeId ?? "");
      setRunningHubPromptFieldName(saved.runningHubPromptFieldName ?? "");
      setRunningHubImageNodeId(saved.runningHubImageNodeId ?? "");
      setRunningHubImageFieldName(saved.runningHubImageFieldName ?? "");
      recordStatus({ tone: "ready", message: "Connections saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingConnections(false);
    }
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
          Подключения
        </button>
        {activeTab === "studio" ? (
          <button
            className="reset-session-button"
            disabled={isImporting || isGeneratingPrompt || isGeneratingImages}
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
              onChange={(event) => {
                setUrlNotice(null);
                setUrl(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isImporting) {
                  void handleImport();
                }
              }}
              placeholder="https://www.instagram.com/reel/..."
              value={urlNotice ?? url}
            />
            <button
              className="primary-button"
              disabled={isImporting || !isBackendCurrent}
              onClick={() => void handleImport()}
              type="button"
            >
              {isImporting ? "Importing" : "Import"}
            </button>
            <button
              className="secondary-button"
              disabled={isImporting || !isBackendCurrent}
              onClick={() => void handleImport(true)}
              type="button"
            >
              Обновить заново
            </button>
            <label className="secondary-button upload-image-button">
              Загрузить изображение
              <input accept="image/*" disabled={isImporting} multiple onChange={(event) => void handleLocalImageUpload(event.target.files)} ref={localImageInputRef} type="file" />
            </label>
            <button className="secondary-button" onClick={handleOpenFolder} type="button">Open Folder</button>
          </section>

          <section className="workspace">
            <section className="preview-panel">
              <Preview
                generationPrefixOptions={generationPrefixOptions}
                generationPrefixSelection={generationPrefixSelection}
                onChangePrefix={setGenerationPrefixSelection}
                onEditPrefixes={() => setIsEditingGenerationPrefixes(true)}
                isGeneratingPrompt={isGeneratingPrompt}
                isGeneratingImages={isGeneratingImages}
                onGenerateImages={handleGenerateImages}
                onGenerateImagePrompts={handleGenerateImagePrompts}
                onSavePrompt={handleSavePrompt}
                onSelectMaterial={(material) => {
                  setSelectedItemId(material.importItem.id);
                  setSelectedMediaId(material.id);
                }}
                onToggleMaterial={(materialId) => setSelectedForGeneration((current) => toggleMediaSelection(current, materialId))}
                promptDocuments={promptDocuments}
                selectedForGeneration={selectedForGeneration}
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
          <div className="panel-label">Подключения</div>
          <div className="connection-card scrapecreators-card">
            <div>
              <h2>ScrapeCreators</h2>
              <KeyStatus hasKey={connections.hasScrapeCreatorsApiKey} preview={connections.scrapeCreatorsApiKeyPreview} />
            </div>
            <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("scrapeCreatorsApiKey")} onEdit={() => handleEditKey("scrapeCreatorsApiKey")} />
          </div>
          <div className="connection-card ollama-card">
            <div className="ollama-settings">
              <h2>Ollama</h2>
              <div className="provider-toggle" role="group" aria-label="Источник Ollama">
                <button className={ollamaProvider === "cloud" ? "active" : ""} onClick={() => setOllamaProvider("cloud")} type="button">Ollama Cloud</button>
                <button className={ollamaProvider === "local" ? "active" : ""} onClick={() => setOllamaProvider("local")} type="button">Локальная Ollama</button>
              </div>
              <KeyStatus hasKey={connections.hasOllamaCloudApiKey === true} preview={connections.ollamaCloudApiKeyPreview} />
              <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("ollamaCloudApiKey")} onEdit={() => handleEditKey("ollamaCloudApiKey")} />
              <div className="ollama-models">
                <label>
                <span>Cloud model</span>
                <div className="model-control">
                  <select disabled={!connections.hasOllamaCloudApiKey} onChange={(event) => setOllamaCloudModel(event.target.value)} value={ollamaCloudModel}>
                    <option value="">Выберите модель</option>
                    {cloudModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <button aria-label="Обновить модели Ollama Cloud" disabled={!connections.hasOllamaCloudApiKey || isRefreshingCloudModels} onClick={() => void refreshOllamaModels("cloud")} type="button">↻</button>
                </div>
              </label>
                <label>
                <span>Local model</span>
                <div className="model-control">
                  <select onChange={(event) => setOllamaLocalModel(event.target.value)} value={ollamaLocalModel}>
                    <option value="">Выберите модель</option>
                    {localModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <button aria-label="Обновить модели локальной Ollama" disabled={isRefreshingLocalModels} onClick={() => void refreshOllamaModels("local")} type="button">↻</button>
                </div>
              </label>
              </div>
            </div>
            <label className="instruction-control">
              <span>Промт для генерации</span>
              <textarea onChange={(event) => setOllamaPromptInstruction(event.target.value)} placeholder="Инструкция для генерации промта" rows={8} value={ollamaPromptInstruction} />
            </label>
          </div>
          <div className="connection-card runninghub-card">
            <div>
              <h2>RunningHub ComfyUI</h2>
              <KeyStatus hasKey={connections.hasRunningHubApiKey} preview={connections.runningHubApiKeyPreview} />
            </div>
            <KeyActions disabled={isSavingKey} onClear={() => void handleClearKey("runningHubApiKey")} onEdit={() => handleEditKey("runningHubApiKey")} />
            <div className="connections-grid">
              <label>
                <span>Workflow ID</span>
                <input
                  className="secret-input"
                  onChange={(event) => setRunningHubWorkflowId(event.target.value)}
                  placeholder="1904136902449209346"
                  value={runningHubWorkflowId}
                />
              </label>
              <label>
                <span>Prompt node ID</span>
                <input
                  className="secret-input"
                  onChange={(event) => setRunningHubPromptNodeId(event.target.value)}
                  placeholder="6"
                  value={runningHubPromptNodeId}
                />
              </label>
              <label>
                <span>Prompt field</span>
                <input
                  className="secret-input"
                  onChange={(event) => setRunningHubPromptFieldName(event.target.value)}
                  placeholder="text"
                  value={runningHubPromptFieldName}
                />
              </label>
              <label>
                <span>Image node ID</span>
                <input className="secret-input" onChange={(event) => setRunningHubImageNodeId(event.target.value)} placeholder="39" value={runningHubImageNodeId} />
              </label>
              <label>
                <span>Image field</span>
                <input className="secret-input" onChange={(event) => setRunningHubImageFieldName(event.target.value)} placeholder="image" value={runningHubImageFieldName} />
              </label>
            </div>
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
  onChangePrefix,
  onEditPrefixes,
  isGeneratingPrompt,
  isGeneratingImages,
  onGenerateImages,
  onGenerateImagePrompts,
  onSavePrompt,
  onSelectMaterial,
  onToggleMaterial,
  promptDocuments,
  selectedForGeneration,
  selectedForGenerationCount,
  selected,
  materials,
  setSelectedForGeneration,
  setPromptDocuments
}: {
  generationPrefixOptions: string;
  generationPrefixSelection: string;
  onChangePrefix: (value: string) => void;
  onEditPrefixes: () => void;
  isGeneratingPrompt: boolean;
  isGeneratingImages: boolean;
  onGenerateImages: () => void;
  onGenerateImagePrompts: () => void;
  onSavePrompt: (mediaId: string) => void;
  onSelectMaterial: (material: MediaMaterial) => void;
  onToggleMaterial: (materialId: string) => void;
  promptDocuments: PromptDocument[];
  selectedForGeneration: string[];
  selectedForGenerationCount: number;
  selected?: MediaMaterial;
  materials: MediaMaterial[];
  setSelectedForGeneration: React.Dispatch<React.SetStateAction<string[]>>;
  setPromptDocuments: React.Dispatch<React.SetStateAction<PromptDocument[]>>;
}) {
  const importItem = selected?.importItem;
  const imageSource = selected?.files.image ?? selected?.files.firstFrame ?? selected?.files.thumbnail;

  return (
    <div className="preview-content">
      <div className="preview-main">
        <div className="preview-column"><div className="panel-label">Preview</div>
        <div className="media-stage">
          {selected?.files.video ? (
            <video controls poster={selected.files.firstFrame ?? selected.files.thumbnail} src={selected.files.video} />
          ) : imageSource && importItem ? (
            <img alt={importItem.title ?? "Imported Instagram media"} src={imageSource} />
          ) : selected ? (
            <div className="preview-empty">No preview file was generated for this import.</div>
          ) : null}
        </div>
        </div>
        <MediaSelector materials={materials} onSelect={onSelectMaterial} onSelectAll={() => setSelectedForGeneration(materials.map((material) => material.id))} onToggle={onToggleMaterial} selected={selected} selectedForGeneration={selectedForGeneration} />
        <aside className="preview-details"><div className="panel-label">Info</div>
          <div className="info-content">
            <section className="caption-panel">
              <div className="panel-label">Text</div>
              <div className="caption-text">{importItem?.caption ?? ""}</div>
            </section>
            <dl className="metadata-grid">
              <div>
                <dt>Source kind</dt>
                <dd>{importItem?.sourceKind ?? ""}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selected?.mediaType ?? ""}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{importItem?.status ?? ""}</dd>
              </div>
              <div>
                <dt>Imported</dt>
                <dd>{importItem ? new Date(importItem.createdAt).toLocaleString() : ""}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{importItem ? (importItem.sourceUrl.startsWith("local://") ? "Локальное изображение — ссылка Instagram отсутствует" : <a href={importItem.sourceUrl} rel="noreferrer" target="_blank">Open Instagram link</a>) : ""}</dd>
              </div>
            </dl>
          </div>
        </aside>
        <GenerationWorkspace
          generationPrefixOptions={generationPrefixOptions}
          generationPrefixSelection={generationPrefixSelection}
          onChangePrefix={onChangePrefix}
          onEditPrefixes={onEditPrefixes}
          isGeneratingImages={isGeneratingImages}
          isGeneratingPrompt={isGeneratingPrompt}
          onGenerateImages={onGenerateImages}
          onGenerateImagePrompts={onGenerateImagePrompts}
          selectedForGenerationCount={selectedForGenerationCount}
        />
      </div>
      <PromptEditors
        documents={promptDocuments.filter((document) => selectedForGeneration.includes(document.mediaId))}
        isBusy={isGeneratingPrompt || isGeneratingImages}
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
  onChangePrefix,
  onEditPrefixes,
  isGeneratingImages,
  isGeneratingPrompt,
  onGenerateImages,
  onGenerateImagePrompts,
  selectedForGenerationCount
}: {
  generationPrefixOptions: string;
  generationPrefixSelection: string;
  onChangePrefix: (value: string) => void;
  onEditPrefixes: () => void;
  isGeneratingImages: boolean;
  isGeneratingPrompt: boolean;
  onGenerateImages: () => void;
  onGenerateImagePrompts: () => void;
  selectedForGenerationCount: number;
}) {
  const isBusy = isGeneratingPrompt || isGeneratingImages;

  return (
    <div className="generation-column"><div className="panel-label">Generation workspace</div><aside className="generation-panel">
      <div className="generation-prefix-control"><select onChange={(event) => onChangePrefix(event.target.value)} value={generationPrefixSelection}><option value="">Не выбрано</option>{parseGenerationPrefixes(generationPrefixOptions).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button aria-label="Редактировать варианты промта" onClick={onEditPrefixes} type="button">✎</button></div>
      <button
        disabled={isBusy || selectedForGenerationCount === 0}
        onClick={onGenerateImagePrompts}
        type="button"
      >
        {isGeneratingPrompt ? "Generating" : `Generate prompt (${selectedForGenerationCount})`}
      </button>
      <button
        disabled={isBusy}
        onClick={onGenerateImages}
        type="button"
      >
        {isGeneratingImages ? "Generating" : `Image generation (${selectedForGenerationCount})`}
      </button>
      <button disabled type="button">Video generation</button>
      <button disabled type="button">Trend analysis</button>
      <button disabled type="button">Caption and hashtags</button>
    </aside></div>
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
  return (
    <aside className="media-selector">
      <div className="panel-label">Media</div>
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
      <button onClick={onSelectAll} type="button">Выбрать все</button>
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
  if (keyName === "scrapeCreatorsApiKey") {
    return "ScrapeCreators";
  }
  if (keyName === "ollamaCloudApiKey") {
    return "Ollama Cloud";
  }
  return "RunningHub";
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function formatActivityLogForCopy(entries: ActivityLogEntry[]): string {
  return entries
    .map((entry) => {
      const source = entry.source ? ` [${entry.source}]` : "";
      return `${new Date(entry.createdAt).toLocaleString()}${source} ${createStatusLogText(entry.tone, entry.message)}`;
    })
    .join("\n\n");
}
