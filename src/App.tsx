import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkInstagramUrl,
  generateImagePrompts,
  generateImages,
  getConnections,
  getHealth,
  importInstagramUrl,
  listImports,
  openImportsFolder,
  resetMediaSession,
  saveConnections,
  type PublicConnections
} from "./lib/api";
import type { CurrentMediaSession, ImportItem, SceneBible } from "./lib/importTypes";
import { validateInstagramUrl } from "./lib/instagramUrl";
import { createMediaMaterials, createSessionMediaMaterials, type MediaMaterial } from "./lib/mediaMaterials";
import { toggleMediaSelection } from "./lib/mediaSelection";
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
    hasRunningHubApiKey: false,
    hasRunningHubWorkflow: false
  });
  const [scrapeCreatorsApiKey, setScrapeCreatorsApiKey] = useState("");
  const [runningHubApiKey, setRunningHubApiKey] = useState("");
  const [runningHubWorkflowId, setRunningHubWorkflowId] = useState("");
  const [runningHubPromptNodeId, setRunningHubPromptNodeId] = useState("");
  const [runningHubPromptFieldName, setRunningHubPromptFieldName] = useState("text");
  const [runningHubWorkflowFileName, setRunningHubWorkflowFileName] = useState("");
  const [runningHubWorkflowJson, setRunningHubWorkflowJson] = useState("");
  const [isSavingConnections, setIsSavingConnections] = useState(false);

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
        setScrapeCreatorsApiKey(loadedConnections.scrapeCreatorsApiKeyPreview ?? "");
        setRunningHubApiKey(loadedConnections.runningHubApiKeyPreview ?? "");
        setRunningHubWorkflowId(loadedConnections.runningHubWorkflowId ?? "");
        setRunningHubPromptNodeId(loadedConnections.runningHubPromptNodeId ?? "");
        setRunningHubPromptFieldName(loadedConnections.runningHubPromptFieldName ?? "text");
        setRunningHubWorkflowFileName(loadedConnections.runningHubWorkflowFileName ?? "");
      })
      .catch((error: unknown) => {
        recordStatus({ tone: "error", message: toErrorMessage(error) });
      });
  }, []);

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
      setCurrentSession(imported.session);
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

  async function handleOpenFolder() {
    try {
      await openImportsFolder();
      recordStatus({ tone: "ready", message: "Opened imports folder." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    }
  }

  async function handleResetMediaSession() {
    try {
      const resetSession = await resetMediaSession();
      setCurrentSession(resetSession);
      setSessionMediaItemIds(resetSession.itemIds);
      setSelectedItemId(null);
      setSelectedMediaId(null);
      setIsMediaSessionReset(true);
      setSelectedForGeneration([]);
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    }
  }

  async function handleGenerateImagePrompts() {
    const selectedPromptMedia = createSelectedPromptMedia(mediaMaterials, selectedForGeneration, currentSession);

    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before prompt generation." });
      return;
    }

    setIsGeneratingPrompt(true);
    recordStatus({ tone: "running", message: "Generating Ideogram JSON prompt with local Ollama." });
    try {
      const generated = await generateImagePrompts(selectedPromptMedia);
      setCurrentSession(generated.session);
      setSessionMediaItemIds(generated.session.itemIds);
      setIsMediaSessionReset(false);
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsGeneratingPrompt(false);
    }
  }

  async function handleGenerateImages() {
    const selectedPromptMedia = mediaMaterials
      .filter((material) => selectedForGeneration.includes(material.id))
      .map((material) => createPromptMediaInput(material, currentSession))
      .filter((material): material is PromptMediaInput => Boolean(material));

    if (selectedPromptMedia.length === 0) {
      recordStatus({ tone: "error", message: "Select one or more Media items before image generation." });
      return;
    }

    setIsGeneratingImages(true);
    recordStatus({ tone: "running", message: "Generating Ideogram JSON prompt with local Ollama, then sending it to RunningHub." });
    try {
      const generated = await generateImages(selectedPromptMedia);
      setItems((current) => [generated.item, ...current.filter((item) => item.id !== generated.item.id)]);
      const generatedMedia = createMediaMaterials(generated.item);
      setCurrentSession(generated.session);
      setSessionMediaItemIds(generated.session.itemIds);
      setIsMediaSessionReset(false);
      setSelectedMediaId(generatedMedia[0]?.id ?? null);
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
        scrapeCreatorsApiKey,
        runningHubApiKey,
        runningHubWorkflowId,
        runningHubPromptNodeId,
        runningHubPromptFieldName,
        runningHubWorkflowFileName,
        runningHubWorkflowJson
      });
      setConnections(saved);
      setScrapeCreatorsApiKey(saved.scrapeCreatorsApiKeyPreview ?? "");
      setRunningHubApiKey(saved.runningHubApiKeyPreview ?? "");
      setRunningHubWorkflowId(saved.runningHubWorkflowId ?? "");
      setRunningHubPromptNodeId(saved.runningHubPromptNodeId ?? "");
      setRunningHubPromptFieldName(saved.runningHubPromptFieldName ?? "text");
      setRunningHubWorkflowFileName(saved.runningHubWorkflowFileName ?? "");
      setRunningHubWorkflowJson("");
      recordStatus({ tone: "ready", message: "Connections saved locally." });
    } catch (error) {
      recordStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsSavingConnections(false);
    }
  }

  async function handleRunningHubWorkflowFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      JSON.parse(text);
      setRunningHubWorkflowFileName(file.name);
      setRunningHubWorkflowJson(text);
      recordStatus({ tone: "ready", message: `RunningHub workflow selected: ${file.name}` });
    } catch {
      recordStatus({ tone: "error", message: "RunningHub workflow file must be valid JSON." });
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
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isImporting) {
                  void handleImport();
                }
              }}
              placeholder="https://www.instagram.com/reel/..."
              value={url}
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
            <button className="secondary-button" disabled={isChecking || isImporting || !isBackendCurrent} onClick={handleCheckImport} type="button">
              {isChecking ? "Checking" : "Check"}
            </button>
            <button className="secondary-button" onClick={handleOpenFolder} type="button">Open Folder</button>
          </section>

          <section className="workspace">
            <section className="preview-panel">
              <div className="panel-label">Preview</div>
              <Preview
                isGeneratingPrompt={isGeneratingPrompt}
                isGeneratingImages={isGeneratingImages}
                onGenerateImages={handleGenerateImages}
                onGenerateImagePrompts={handleGenerateImagePrompts}
                selected={selectedMedia}
                selectedForGenerationCount={selectedForGeneration.length}
              />
            </section>
          </section>

          <section className="bottom-gallery">
            <div className="panel-label">Media</div>
            <div className="gallery-strip">
              {mediaMaterials.length === 0 ? (
                <span>Current import media will appear here.</span>
              ) : (
                mediaMaterials.map((material) => (
                  <div
                    className={[
                      "gallery-item",
                      material.id === selectedMedia?.id ? "selected" : "",
                      selectedForGeneration.includes(material.id) ? "queued" : ""
                    ].filter(Boolean).join(" ")}
                    key={material.id}
                  >
                    <button
                      className="gallery-preview"
                      onClick={() => {
                        setSelectedItemId(material.importItem.id);
                        setSelectedMediaId(material.id);
                      }}
                      type="button"
                    >
                      <GalleryThumb material={material} />
                      <span>{material.label}</span>
                      <span className="gallery-scene-label">{getSceneForMaterial(material, currentSession)?.name ?? "No scene"}</span>
                    </button>
                    <label className="gallery-select">
                      <input
                        checked={selectedForGeneration.includes(material.id)}
                        onChange={() => setSelectedForGeneration((current) => toggleMediaSelection(current, material.id))}
                        type="checkbox"
                      />
                      Use
                    </label>
                  </div>
                ))
              )}
            </div>
          </section>

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
          <div className="connection-card">
            <div>
              <h2>ScrapeCreators</h2>
              <p>
                {connections.hasScrapeCreatorsApiKey
                  ? `Ключ сохранен локально: ${connections.scrapeCreatorsApiKeyPreview}`
                  : "Ключ не сохранен."}
              </p>
            </div>
            <input
              className="secret-input"
              onFocus={() => {
                if (connections.scrapeCreatorsApiKeyPreview && scrapeCreatorsApiKey === connections.scrapeCreatorsApiKeyPreview) {
                  setScrapeCreatorsApiKey("");
                }
              }}
              onChange={(event) => setScrapeCreatorsApiKey(event.target.value)}
              placeholder="Вставь новый API key"
              type={scrapeCreatorsApiKey === connections.scrapeCreatorsApiKeyPreview ? "text" : "password"}
              value={scrapeCreatorsApiKey}
            />
          </div>
          <div className="connection-card runninghub-card">
            <div>
              <h2>RunningHub ComfyUI</h2>
              <p>
                {connections.hasRunningHubApiKey
                  ? `Ключ сохранен локально: ${connections.runningHubApiKeyPreview}`
                  : "Ключ не сохранен."}
                {" "}
                {connections.hasRunningHubWorkflow
                  ? `Workflow: ${connections.runningHubWorkflowFileName ?? "saved JSON"}`
                  : "Workflow JSON не выбран."}
              </p>
            </div>
            <div className="connections-grid">
              <label>
                <span>API key</span>
                <input
                  className="secret-input"
                  onFocus={() => {
                    if (connections.runningHubApiKeyPreview && runningHubApiKey === connections.runningHubApiKeyPreview) {
                      setRunningHubApiKey("");
                    }
                  }}
                  onChange={(event) => setRunningHubApiKey(event.target.value)}
                  placeholder="RunningHub API key"
                  type={runningHubApiKey === connections.runningHubApiKeyPreview ? "text" : "password"}
                  value={runningHubApiKey}
                />
              </label>
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
            </div>
            <label className="workflow-file-control">
              <span>{runningHubWorkflowFileName || "Выбрать workflow JSON"}</span>
              <input
                accept=".json,application/json"
                onChange={(event) => void handleRunningHubWorkflowFile(event.target.files?.[0])}
                type="file"
              />
            </label>
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
            Ключ хранится в локальном файле data/connections.local.json. Этот путь добавлен в .gitignore.
          </div>
        </section>
      )}
    </main>
  );
}

function Preview({
  isGeneratingPrompt,
  isGeneratingImages,
  onGenerateImages,
  onGenerateImagePrompts,
  selectedForGenerationCount,
  selected
}: {
  isGeneratingPrompt: boolean;
  isGeneratingImages: boolean;
  onGenerateImages: () => void;
  onGenerateImagePrompts: () => void;
  selectedForGenerationCount: number;
  selected?: MediaMaterial;
}) {
  if (!selected) {
    return <div className="preview-empty">Import an Instagram post or reel to preview media here.</div>;
  }

  const { importItem } = selected;
  const imageSource = selected.files.image ?? selected.files.firstFrame ?? selected.files.thumbnail;

  return (
    <div className="preview-content">
      <div className="preview-main">
        <div className="media-stage">
          {selected.files.video ? (
            <video controls poster={selected.files.firstFrame ?? selected.files.thumbnail} src={selected.files.video} />
          ) : imageSource ? (
            <img alt={importItem.title ?? "Imported Instagram media"} src={imageSource} />
          ) : (
            <div className="preview-empty">No preview file was generated for this import.</div>
          )}
        </div>
        <div className="preview-side">
          <aside className="preview-details">
            <section className="caption-panel">
              <div className="panel-label">Text</div>
              <div className="caption-text">{importItem.caption || "No caption text returned for this media."}</div>
            </section>
            <dl className="metadata-grid">
              <div>
                <dt>Source kind</dt>
                <dd>{importItem.sourceKind ?? "post"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selected.mediaType}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{importItem.status}</dd>
              </div>
              <div>
                <dt>Imported</dt>
                <dd>{new Date(importItem.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd><a href={importItem.sourceUrl} rel="noreferrer" target="_blank">Open Instagram link</a></dd>
              </div>
            </dl>
          </aside>
          <GenerationWorkspace
            isGeneratingImages={isGeneratingImages}
            isGeneratingPrompt={isGeneratingPrompt}
            onGenerateImages={onGenerateImages}
            onGenerateImagePrompts={onGenerateImagePrompts}
            selectedForGenerationCount={selectedForGenerationCount}
          />
        </div>
      </div>
    </div>
  );
}

function GenerationWorkspace({
  isGeneratingImages,
  isGeneratingPrompt,
  onGenerateImages,
  onGenerateImagePrompts,
  selectedForGenerationCount
}: {
  isGeneratingImages: boolean;
  isGeneratingPrompt: boolean;
  onGenerateImages: () => void;
  onGenerateImagePrompts: () => void;
  selectedForGenerationCount: number;
}) {
  const isBusy = isGeneratingPrompt || isGeneratingImages;

  return (
    <aside className="generation-panel">
      <div className="panel-label">Generation workspace</div>
      <button
        disabled={isBusy || selectedForGenerationCount === 0}
        onClick={onGenerateImagePrompts}
        type="button"
      >
        {isGeneratingPrompt ? "Generating" : `Generate prompt (${selectedForGenerationCount})`}
      </button>
      <button
        disabled={isBusy || selectedForGenerationCount === 0}
        onClick={onGenerateImages}
        type="button"
      >
        {isGeneratingImages ? "Generating" : `Image generation (${selectedForGenerationCount})`}
      </button>
      <button disabled type="button">Video generation</button>
      <button disabled type="button">Trend analysis</button>
      <button disabled type="button">Caption and hashtags</button>
    </aside>
  );
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
