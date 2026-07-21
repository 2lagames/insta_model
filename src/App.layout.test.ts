import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("studio preview layout", () => {
  it("keeps vertical source and generated media panels side by side", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain('className="preview-main"');
    expect(appSource).toContain('className="media-column generated-media-column"');
    expect(appSource).toContain('className="log-panel');
    expect(appSource).toContain("Media");
    expect(appSource).toContain('<MediaSelector');
    expect(appSource).toContain('<PromptEditors');
    expect(appSource).toContain("selectedForGeneration");
    expect(appSource).toContain("sessionMediaItemIds");
    expect(appSource).toContain("createSessionMediaMaterials");
    expect(appSource).toContain("handleResetMediaSession");
    expect(appSource).toContain("Сброс");
    expect(appSource).toContain("reset-session-button");
    expect(appSource).toContain("isMediaSessionReset");
    expect(appSource).toContain("createSessionMediaMaterials(items, sessionMediaItemIds, selectedItem, isMediaSessionReset)");
    expect(appSource).not.toContain("setSelectedItemId(generated.item.id)");
    expect(appSource).not.toContain("setSelectedForGeneration(generatedMedia.map");
    expect(appSource).toContain("handleGenerateImagePrompts");
    expect(appSource).toContain("handleGenerateImages");
    expect(appSource).toContain("handleImport(true)");
    expect(appSource).toContain("onClick={() => void handleImport()}");
    expect(appSource).toContain("Обновить заново");
    expect(appSource).toContain('accept="image/*,video/*"');
    expect(appSource).toContain("Using previously downloaded media.");
    expect(appSource.indexOf("Generate prompt")).toBeLessThan(appSource.indexOf("Image generation"));
    expect(appSource).toContain("EventSource");
    expect(appSource).toContain("activityEntries");
    expect(appSource).toContain("logFeedRef");
    expect(appSource).toContain("scrollTop = logFeedRef.current.scrollHeight");
    expect(appSource).not.toContain("const prompt = await generateImagePrompts");
    expect(appSource).not.toContain('recordStatus({ tone: "ready", message: prompt })');
    expect(appSource).toContain("Image generation");
    expect(appSource).toContain("Вставить ключ");
    expect(appSource).toContain("Apify");
    expect(appSource).not.toContain("ScrapeCreators");
    expect(appSource).toContain("Ollama Cloud");
    expect(appSource).toContain("Локальная Ollama");
    expect(appSource).toContain("Workflow bindings");
    expect(appSource).toContain('aria-label="Отменить изменение промта"');
    expect(appSource).toContain("batchPosition: batchIndex + 1");
    expect(appSource).toContain("batchTotal: imageJobs.length");
    expect(appSource).not.toContain("workflow-file-control");
    expect(cssSource).toContain("aspect-ratio: 9 / 16");
    expect(cssSource).toContain(".gallery-select");
    expect(cssSource).toContain(".media-selector");
    expect(cssSource).toContain(".media-selector {\n  height: clamp(560px, 68vh, 780px);\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}");
    expect(cssSource).toContain("grid-template-columns: auto minmax(110px, 150px) minmax(200px, 0.75fr) minmax(180px, 0.5fr)");
    expect(cssSource).toContain(".prompt-editors textarea");
    expect(cssSource).toContain("height: clamp(560px, 68vh, 780px)");
  });

  it("aligns source and generated media columns at the top without stretching the studio panels", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain('className="media-column generated-media-column"');
    expect(cssSource).toContain(".generated-media-column .media-selector {");
    expect(cssSource).toContain("grid-auto-rows: minmax(42px, auto);");
    expect(cssSource).not.toContain("--studio-stage-height");
    expect(cssSource).toContain("overflow-y: auto");
  });

  it("places the Media label above a stage-height selector", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");
    const previewStart = appSource.indexOf("function Preview({");
    const preview = appSource.slice(previewStart, appSource.indexOf("function GenerationWorkspace", previewStart));
    const mediaSelectorStart = appSource.indexOf("function MediaSelector({");
    const mediaSelector = appSource.slice(mediaSelectorStart, appSource.indexOf("function PromptEditors", mediaSelectorStart));

    expect(preview).toContain('<div className="media-column">\n          <div className="panel-label">Media</div>\n          <MediaSelector');
    expect(mediaSelector).not.toContain('className="panel-label"');
    expect(mediaSelector).toContain('className="media-list"');
    expect(mediaSelector).toContain('"Снять выделение" : "Выбрать все"');
    expect(mediaSelector.indexOf('className="media-list"')).toBeLessThan(mediaSelector.indexOf('"Снять выделение" : "Выбрать все"'));
    expect(cssSource).toContain(".media-list");
    expect(cssSource).toContain(".media-list {\n  min-height: 0;\n  flex: 1;");
    expect(cssSource).toContain(".media-list {\n  min-height: 0;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  overflow-y: auto;");
    expect(cssSource).toContain(".media-selector > button {\n  height: 42px;\n  margin-top: 8px;");
    expect(cssSource).toContain(".media-column {\n  min-width: 0;\n}");
  });

  it("uses a scrollable eight-line prompt editor that users can expand", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain("<textarea disabled={isBusy} rows={8}");
    expect(cssSource).toContain(".prompt-editors textarea {\n  height: calc(8 * 1.45em + 22px);");
    expect(cssSource).toContain("overflow-y: auto;");
    expect(cssSource).toContain("resize: vertical;");
    expect(cssSource).not.toContain(".prompt-editors textarea {\n  max-height:");
  });

  it("keeps the Studio workspace visible after the selected media is cleared", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const previewStart = appSource.indexOf("function Preview({");
    const preview = appSource.slice(previewStart, appSource.indexOf("function parseGenerationPrefixes", previewStart));

    expect(preview).not.toContain("if (!selected) {");
    expect(preview).toContain('<div className="preview-content">');
    expect(preview).toContain("<MediaSelector");
    expect(preview).toContain("<GenerationWorkspace");

    const resetStart = appSource.indexOf("async function handleResetMediaSession()");
    const reset = appSource.slice(resetStart, appSource.indexOf("async function handleGenerateImagePrompts", resetStart));
    expect(reset).not.toContain("setGenerationPrefixOptions");
    expect(reset).not.toContain("setGenerationPrefixSelection");
  });

  it("separates generated images from source media and removes the unused Info panel", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const previewStart = appSource.indexOf("function Preview({");
    const preview = appSource.slice(previewStart, appSource.indexOf("function parseGenerationPrefixes", previewStart));

    expect(preview).toContain(">Media</div>");
    expect(preview).toContain(">Generated Media</div>");
    expect(preview).not.toContain(">Info</div>");
    expect(preview).toContain("sourceMaterials");
    expect(preview).toContain("generatedMaterials");
    expect(preview).not.toContain("Studio ID");
    expect(preview).toContain('className="media-column generated-media-column"');
    expect(readFileSync("src/App.css", "utf8")).toContain(".generated-media-column .gallery-item {");
    expect(readFileSync("src/App.css", "utf8")).toContain("grid-template-columns: repeat(4, 116px);");
  });

  it("saves workflow and Ollama preset catalogs", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const saveStart = appSource.indexOf("async function handleSaveConnections()");
    const saveHandler = appSource.slice(saveStart, appSource.indexOf("function addRunningHubWorkflow", saveStart));

    expect(saveHandler).toContain("runningHubWorkflows");
    expect(saveHandler).toContain("ollamaPresets");
    expect(saveHandler).toContain("studioActionButtons");
  });

  it("offers explicit prompt saving and describes a local media source", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("saveSessionPrompts");
    expect(appSource).toContain("onSave");
    expect(appSource).toContain(">Сохранить</button>");
    expect(appSource).toContain("Локальное медиа — ссылка Instagram отсутствует");
    expect(appSource).toContain("urlNotice");
  });

  it("edits generation prefixes in a multiline application dialog", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("function GenerationPrefixDialog");
    expect(appSource).toContain("Название;Текст — одна строка на вариант");
    expect(appSource).not.toContain("window.prompt");
    expect(appSource.indexOf("<GenerationPrefixDialog")).toBeLessThan(appSource.indexOf("<LogPanel"));
  });

  it("replaces API keys without loading their raw value into the browser", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).not.toContain("getConnectionKey");
    expect(appSource).not.toContain("editingKeyValue");
    expect(appSource).toContain('type="password"');
    expect(appSource).toContain('autoComplete="new-password"');
  });

  it("debounces local prompt autosaves and invalidates them when the media session changes", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("createPromptTextRecord");
    expect(appSource).toContain("promptAutosaveRevisionRef");
    expect(appSource).toContain("isPromptAutosaveReadyRef");
    expect(appSource).toContain("window.setTimeout");
    expect(appSource).toContain("window.setTimeout(attemptAutosave, 600)");
    expect(appSource).toContain("saveSessionPrompts(prompts)");
    expect(appSource.match(/promptAutosaveRevisionRef\.current \+= 1/g)?.length).toBeGreaterThanOrEqual(3);
    expect(appSource.match(/isPromptAutosaveReadyRef\.current = true/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("retries a current prompt autosave after acquiring the shared session mutation lock", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const autosaveStart = appSource.indexOf("useEffect(() => {\n    if (!isPromptAutosaveReadyRef.current");
    const autosave = appSource.slice(autosaveStart, appSource.indexOf("async function handleImport", autosaveStart));

    expect(autosave).toContain("if (!tryBeginSessionMutation()) {");
    expect(autosave).toContain("retryTimeout = window.setTimeout(attemptAutosave, 100)");
    expect(autosave).toContain("void saveSessionPrompts(prompts)");
    expect(autosave).toContain(".finally(() => {");
    expect(autosave).toContain("endSessionMutation();");
    expect(autosave).toContain("if (revision !== promptAutosaveRevisionRef.current) {");
  });

  it("supports batch local uploads and keeps text generation explicit", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("multiple");
    expect(appSource).toContain("event.target.files");
    expect(appSource).toContain("appendToSession: index > 0");
    expect(appSource).toContain("toggleAllMediaSelection(current, sourceMaterials.map((material) => material.id))");
    expect(appSource).toContain('hasEveryMaterialSelected ? "Снять выделение" : "Выбрать все"');
    expect(appSource).toContain("setSelectedForGeneration([])");
    expect(appSource).toContain("Generate prompts with a text action before image generation.");
  });

  it("offers a screenshot control above source media selection", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const previewStart = appSource.indexOf("function Preview({");
    const preview = appSource.slice(previewStart, appSource.indexOf("function GenerationWorkspace", previewStart));
    const mediaSelectorStart = appSource.indexOf("function MediaSelector({");
    const mediaSelector = appSource.slice(mediaSelectorStart, appSource.indexOf("function PromptEditors", mediaSelectorStart));

    expect(preview).toContain("onCaptureScreenshot=");
    expect(preview).toContain("canCaptureScreenshot={Boolean(selected?.files.video)}");
    expect(mediaSelector).toContain(">Скриншот</button>");
    expect(mediaSelector.indexOf(">Скриншот</button>")).toBeLessThan(mediaSelector.indexOf('"Снять выделение" : "Выбрать все"'));
  });

  it("captures only the current preview video frame and saves it in Media", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const screenshotStart = appSource.indexOf("async function handleCaptureVideoScreenshot()");
    const screenshotHandler = appSource.slice(screenshotStart, appSource.indexOf("async function handleOpenFolder", screenshotStart));

    expect(appSource).toContain("const previewVideoRef = useRef<HTMLVideoElement | null>(null);");
    expect(appSource).toContain("ref={previewVideoRef}");
    expect(screenshotHandler).toContain("video?.videoWidth");
    expect(screenshotHandler).toContain("canvas.getContext(\"2d\")");
    expect(screenshotHandler).toContain("context.drawImage(video, 0, 0, width, height)");
    expect(screenshotHandler).toContain('canvas.toBlob(resolve, "image/png")');
    expect(screenshotHandler).toContain("new File([blob],");
    expect(screenshotHandler).toContain("uploadLocalImage(file, { appendToSession: true })");
  });

  it("regenerates selected prompts even when a prompt already exists", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const promptCreationStart = appSource.indexOf("async function createSelectedPrompts");
    const promptCreation = appSource.slice(promptCreationStart, appSource.indexOf("async function handleGenerateImagePrompts", promptCreationStart));

    expect(promptCreation).toContain("for (const media of selectedPromptMedia)");
    expect(promptCreation).not.toContain("missingPromptMedia");
    expect(promptCreation).toContain("mergePromptDocuments(current, [prompt])");
  });

  it("offers a video action for one checked source video and generated image", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const videoHandlerStart = appSource.indexOf("async function handleGenerateVideos");
    const videoHandler = appSource.slice(videoHandlerStart, appSource.indexOf("function handleCancelGeneration", videoHandlerStart));

    expect(appSource).toContain("＋ Видео");
    expect(appSource).toContain('if (studioId === "2") return "2 · Prompt image"');
    expect(appSource).toContain('if (studioId === "5") return "5 · Prompt video"');
    expect(videoHandler).toContain("media.mediaType === \"video\"");
    expect(videoHandler).toContain("generatedMaterials.filter");
    expect(videoHandler).toContain("generateVideosWithOptions");
    expect(videoHandler).toContain("Select exactly one source video and one generated image before video generation.");
  });

  it("shows a cancellation action in the generation workspace and uses IMAGE labels", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("cancelGeneration");
    expect(appSource).toContain("onCancelGeneration");
    expect(appSource).toContain(">Отмена</button>");
    expect(appSource).toContain("Настройки");
  });

  it("adds each generated image to the studio before starting the next image job", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const generationStart = appSource.indexOf("async function handleGenerateImages(runningHubWorkflowPresetId: string)");
    const generationHandler = appSource.slice(generationStart, appSource.indexOf("function handleCancelGeneration", generationStart));

    expect(generationHandler).toContain("for (const [batchIndex, imageJob] of imageJobs.entries())");
    expect(generationHandler).toContain("await generateImagesWithOptions([imageJob], {");
    expect(generationHandler).toContain("batchPosition: batchIndex + 1");
    expect(generationHandler).toContain("batchTotal: imageJobs.length");
    expect(generationHandler).toContain("setItems((current) => [generated.item");
    expect(generationHandler).toContain("setCurrentSession(generated.session)");
    expect(generationHandler).toContain("setSessionMediaItemIds(generated.session.itemIds)");
  });

  it("lets users choose one to ten image generations per selected media item", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");
    const generationStart = appSource.indexOf("async function handleGenerateImages(runningHubWorkflowPresetId: string)");
    const generationHandler = appSource.slice(generationStart, appSource.indexOf("function handleCancelGeneration", generationStart));
    const generationWorkspaceStart = appSource.indexOf("function GenerationWorkspace({");
    const generationWorkspace = appSource.slice(generationWorkspaceStart, appSource.indexOf("function MediaSelector", generationWorkspaceStart));

    expect(appSource).toContain("const [imageGenerationsPerMedia, setImageGenerationsPerMedia] = useState(1);");
    expect(generationHandler).toContain("repeatImageGenerationJobs(promptImageJobs, imageGenerationsPerMedia)");
    expect(generationWorkspace).toContain('className="studio-action-select"');
    expect(generationWorkspace).toContain('aria-label="Количество генераций на изображение"');
    expect(generationWorkspace).toContain("Array.from({ length: 10 }");
    expect(generationWorkspace).toContain("Image generation (${imageGenerationCount})");
    expect(cssSource).toContain(".studio-action-button {");
    expect(cssSource).toContain(".studio-action-select");
  });

  it("keeps every successful batch upload reflected locally before a later upload can fail", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const uploadStart = appSource.indexOf("async function handleLocalMediaUpload");
    const uploadHandler = appSource.slice(uploadStart, appSource.indexOf("async function handleOpenFolder", uploadStart));

    expect(uploadHandler).toContain("const imported = await uploadLocalImage");
    expect(uploadHandler).toContain("setCurrentSession(imported.session)");
    expect(uploadHandler).toContain("setSessionMediaItemIds(imported.session.itemIds)");
    expect(uploadHandler).toContain("setSelectedForGeneration(firstImportedMedia[0]?.id ? [firstImportedMedia[0].id] : []);");
    expect(uploadHandler.indexOf("setCurrentSession(imported.session)")).toBeLessThan(uploadHandler.indexOf("} catch"));
  });

  it("locks prompt editors while any persistent session mutation is running", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const promptEditorsStart = appSource.indexOf("function PromptEditors({");
    const promptEditors = appSource.slice(promptEditorsStart);

    expect(appSource).toContain("isBusy={isSessionMutationBusy}");
    expect(promptEditors).toContain("isBusy: boolean;");
    expect(promptEditors).toContain("disabled={isBusy || document.historyIndex === 0}");
    expect(promptEditors).toContain("disabled={isBusy || document.historyIndex === document.history.length - 1}");
    expect(promptEditors).toContain("disabled={isBusy}");
  });

  it("serializes every persistent session mutation, including resets and manual prompt saves", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const controlsStart = appSource.indexOf('<section className="top-bar">');
    const controls = appSource.slice(controlsStart, appSource.indexOf('<section className="workspace">', controlsStart));
    const previewStart = appSource.indexOf("function Preview({");
    const preview = appSource.slice(previewStart, appSource.indexOf("function parseGenerationPrefixes", previewStart));
    const generationWorkspaceStart = appSource.indexOf("function GenerationWorkspace({");
    const generationWorkspace = appSource.slice(generationWorkspaceStart, appSource.indexOf("function MediaSelector", generationWorkspaceStart));

    const resetStart = appSource.indexOf("async function handleResetMediaSession()");
    const reset = appSource.slice(resetStart, appSource.indexOf("async function handleGenerateImagePrompts", resetStart));
    const savePromptStart = appSource.indexOf("async function handleSavePrompt(mediaId: string)");
    const savePrompt = appSource.slice(savePromptStart, appSource.indexOf("async function handleSaveGenerationPrefixes", savePromptStart));

    expect(appSource).toContain("const [isResetting, setIsResetting] = useState(false);");
    expect(appSource).toContain("const [isSavingPrompt, setIsSavingPrompt] = useState(false);");
    expect(appSource).toContain("const isSessionMutationBusy = isImporting || isResetting || isSavingPrompt || isGeneratingPrompt || isGeneratingImages || isGeneratingVideos;");
    expect(appSource).toContain("const isSessionMutationBusyRef = useRef(false);");
    expect(appSource).toContain("function tryBeginSessionMutation()");
    expect(controls).toContain("disabled={isSessionMutationBusy}");
    expect(controls).toContain("disabled={isSessionMutationBusy || !isBackendCurrent}");
    expect(controls).toContain('event.key === "Enter" && !isSessionMutationBusy');
    expect(preview).toContain("isSessionMutationBusy={isSessionMutationBusy}");
    expect(generationWorkspace).toContain("isSessionMutationBusy: boolean;");
    expect(generationWorkspace).toContain("disabled={isSessionMutationBusy || selectedForGenerationCount === 0 || !ready}");
    expect(generationWorkspace).toContain("disabled={isSessionMutationBusy}");
    expect(preview).toContain("isBusy={isSessionMutationBusy}");
    expect(reset).toContain("if (!tryBeginSessionMutation())");
    expect(reset).toContain("setIsResetting(true);");
    expect(reset).toContain("setIsResetting(false);");
    expect(savePrompt).toContain("if (!tryBeginSessionMutation())");
    expect(savePrompt).toContain("setIsSavingPrompt(true);");
    expect(savePrompt).toContain("setIsSavingPrompt(false);");
  });

  it("lays out Ollama presets across the Settings card and places add actions at the bottom", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain("ollama-preset-layout");
    expect(appSource).toContain("preset-add-button");
    expect(appSource).toContain("preset-add-row");
    expect(cssSource).toContain(".ollama-preset-layout {");
    expect(cssSource).toContain("grid-template-columns: minmax(220px, 0.2fr) minmax(0, 0.8fr);");
    expect(cssSource).toContain(".ollama-preset-layout .ollama-preset-instruction {");
    expect(cssSource).toContain(".preset-add-row {");
    expect(appSource).toContain("getEditableRunningHubBindings(workflow.bindings)");
  });

  it("shows only explicitly added generation actions and lets their list grow", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");
    const generationWorkspaceStart = appSource.indexOf("function GenerationWorkspace({");
    const generationWorkspace = appSource.slice(generationWorkspaceStart, appSource.indexOf("function MediaSelector", generationWorkspaceStart));

    expect(generationWorkspace).toContain("Video generation");
    expect(generationWorkspace).not.toContain("Trend analysis");
    expect(generationWorkspace).not.toContain("Caption and hashtags");
    expect(cssSource).toContain("grid-auto-rows: minmax(42px, auto);");
  });

  it("places generation action add controls below cancellation", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const generationWorkspaceStart = appSource.indexOf("function GenerationWorkspace({");
    const generationWorkspace = appSource.slice(generationWorkspaceStart, appSource.indexOf("function MediaSelector", generationWorkspaceStart));

    expect(generationWorkspace.indexOf("onClick={onCancelGeneration}")).toBeLessThan(generationWorkspace.indexOf('className="studio-action-add"'));
  });

  it("keeps workflow selectors compact without clipping their selected IDs", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain("<option value=\"\">□</option>");
    expect(appSource).toContain("<option key={preset.id} value={preset.id}>{preset.displayId}</option>");
    expect(cssSource).toContain("grid-template-columns: minmax(0, 1fr) 84px 42px 32px;");
  });
});
