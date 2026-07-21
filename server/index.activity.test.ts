import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("image prompt activity", () => {
  it("appends later local uploads to the current media session", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const uploadRouteStart = source.indexOf('app.post("/api/imports/upload-image"');
    const uploadRoute = source.slice(uploadRouteStart, source.indexOf('app.get("/api/connections"', uploadRouteStart));

    expect(uploadRoute).toContain('request.get("X-Append-To-Session") === "true"');
    expect(uploadRoute).toContain("store.appendToCurrentSession(item.id)");
    expect(uploadRoute).toContain("store.startCurrentSession(item.id)");
  });

  it("stores local videos with a first-frame preview", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const uploadRouteStart = source.indexOf('app.post("/api/imports/upload-image"');
    const uploadRoute = source.slice(uploadRouteStart, source.indexOf('app.get("/api/connections"', uploadRouteStart));
    const videoItemStart = source.indexOf("async function createLocalVideoItem");
    const videoItem = source.slice(videoItemStart, source.indexOf("function isGenerationCancelled", videoItemStart));

    expect(uploadRoute).toContain('type: ["image/*", "video/*"]');
    expect(uploadRoute).toContain("createLocalVideoItem");
    expect(videoItem).toContain("generateFirstFrameWithFfmpeg");
    expect(videoItem).toContain("firstFrame: firstFramePath");
    expect(videoItem).toContain("thumbnail: firstFramePath");
    expect(videoItem).toContain("video: mediaPath");
  });

  it("publishes each generated prompt into the activity log", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain("Generated prompt for ${mediaItem.label}");
    expect(source).toContain("message: generatedPrompt.prompt");
    expect(source.indexOf("message: generatedPrompt.prompt")).toBeGreaterThan(source.indexOf("generateOllamaPrompt"));
  });

  it("keeps Instagram import separate from Ollama scene analysis", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const importRouteStart = source.indexOf('app.post("/api/imports"');
    const resetRouteStart = source.indexOf('app.post("/api/imports/session/reset"');
    const importRoute = source.slice(importRouteStart, resetRouteStart);

    expect(importRoute).toContain("importInstagramUrl");
    expect(importRoute).toContain("store.startCurrentSession(item.id)");
    expect(importRoute).not.toContain("generateSceneBiblesForImport");
    expect(importRoute).not.toContain("ensureSceneBiblesForPromptMedia");
  });

  it("reuses a healthy local import unless a refresh is requested", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const importRouteStart = source.indexOf('app.post("/api/imports"');
    const resetRouteStart = source.indexOf('app.post("/api/imports/session/reset"');
    const importRoute = source.slice(importRouteStart, resetRouteStart);

    expect(importRoute).toContain("store.findNewestReusableBySourceUrl(validation.url)");
    expect(importRoute).toContain("forceRefresh");
    expect(importRoute).toContain("reused: true");
    expect(importRoute).toContain("reused: false");
  });

  it("exposes a route for cleaning duplicate Instagram imports", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain('app.post("/api/imports/cleanup"');
    expect(source).toContain("store.cleanupDuplicateInstagramImports()");
  });

  it("opens the generated output folder from the Studio toolbar", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const routeStart = source.indexOf('app.post("/api/open-imports-folder"');
    const route = source.slice(routeStart, source.indexOf('app.post("/api/generation/image-prompts"', routeStart));

    expect(route).toContain("await mkdir(outputDir, { recursive: true })");
    expect(route).toContain('spawn("open", [outputDir]');
  });

  it("generates separate prompts from the active persisted Ollama configuration", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const promptRouteStart = source.indexOf('app.post("/api/generation/image-prompts"');
    const imageRouteStart = source.indexOf('app.post("/api/generation/images"');
    const promptRoute = source.slice(promptRouteStart, imageRouteStart);

    expect(promptRoute).toContain("connectionsStore.readPrivate()");
    expect(promptRoute).toContain("generateOllamaPrompt");
    expect(promptRoute).toContain("response.json({ prompts, session })");
  });

  it("exposes selected Ollama model lists without querying Cloud until a key exists", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain('app.get("/api/ollama/models"');
    expect(source).toContain('request.query.provider === "cloud" ? "cloud" : "local"');
    expect(source).toContain('listOllamaModels({ provider, apiKey: connections.ollamaCloudApiKey })');
  });

  it("keeps key editing behind dedicated private connection routes", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).not.toContain('app.get("/api/connections/keys/:keyName"');
    expect(source).toContain('app.put("/api/connections/keys/:keyName"');
    expect(source).toContain('app.delete("/api/connections/keys/:keyName"');
    expect(source).toContain("connectionsStore.saveKey");
    expect(source).toContain("connectionsStore.clearKey");
  });

  it("does not accept API keys through the ordinary settings route", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const settingsStart = source.indexOf('app.put("/api/connections"');
    const settingsEnd = source.indexOf('app.put("/api/connections/keys/:keyName"', settingsStart);
    const settingsRoute = source.slice(settingsStart, settingsEnd);

    expect(settingsRoute).not.toContain("apifyApiToken");
    expect(settingsRoute).not.toContain("ollamaCloudApiKey");
    expect(settingsRoute).not.toContain("runningHubApiKey");
  });

  it("serves only allowlisted import metadata instead of the private data directory", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).not.toContain('app.use("/media", express.static(dataDir))');
    expect(source).toContain('app.get("/media/imports/:importId/apify-media.json"');
    expect(source).toContain("resolveImportMetadataPath");
  });

  it("uses the Apify token for Instagram imports", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const importRouteStart = source.indexOf('app.post("/api/imports"');
    const importRoute = source.slice(importRouteStart, source.indexOf('app.post("/api/imports/cleanup"', importRouteStart));

    expect(importRoute).toContain("apifyApiToken: connections.apifyApiToken ?? \"\"");
    expect(source).toContain('importProvider: "apify"');
  });

  it("allows reels through the import route for the Apify reel importer", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const importRouteStart = source.indexOf('app.post("/api/imports"');
    const cacheLookup = source.indexOf("store.findNewestReusableBySourceUrl", importRouteStart);
    const importRoute = source.slice(importRouteStart, cacheLookup);

    expect(importRoute).not.toContain('getInstagramSourceKind(validation.url) === "reel"');
  });

  it("preserves saved RunningHub bindings when unrelated connection fields are updated", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain("runningHubBindings: parseRunningHubBindings(request.body?.runningHubBindings)");
    expect(source).toContain("if (!Array.isArray(value))");
  });

  it("runs RunningHub only with submitted media and edited prompts", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const imageRouteStart = source.indexOf('app.post("/api/generation/images"');
    const imageRoute = source.slice(imageRouteStart, source.indexOf("const host", imageRouteStart));

    expect(imageRoute).toContain("parseRunningHubPromptJobs(request.body?.jobs)");
    expect(imageRoute).not.toContain("generateIdeogramPromptForMedia");
    expect(imageRoute).not.toContain("workflowJson");
    expect(imageRoute).toContain("imagePath: job.media.generatedImagePath ? undefined : resolveStudioMediaPath(job.media.imagePath)");
    expect(imageRoute).toContain("videoPath: job.media.videoPath ? resolveStudioMediaPath(job.media.videoPath) : undefined");
    expect(imageRoute).toContain("onTaskCreated");
    expect(imageRoute).toContain("activeGeneration.registerRunningHubTask");
  });

  it("runs a video workflow with the checked source video, generated image, and video prompt", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const videoRouteStart = source.indexOf('app.post("/api/generation/videos"');
    const videoRoute = source.slice(videoRouteStart, source.indexOf('app.post("/api/generation/cancel"', videoRouteStart));

    expect(videoRoute).toContain("parseRunningHubVideoJob(request.body?.job)");
    expect(videoRoute).toContain("runRunningHubVideoGeneration");
    expect(videoRoute).toContain("videoPath: resolveStudioMediaPath(job.sourceVideo.videoPath)");
    expect(videoRoute).toContain("generatedImagePath: resolveStudioMediaPath(job.generatedImage.generatedImagePath)");
    expect(videoRoute).toContain("prompt: job.prompt");
  });

  it("exposes one cancellation route for active generation work", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain('app.post("/api/generation/cancel"');
    expect(source).toContain("generationController.cancel()");
    expect(source).toContain("Generation cancellation requested.");
  });

  it("persists explicitly saved prompt text in the current session", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain('app.put("/api/imports/session/prompts"');
    expect(source).toContain("parsePromptTexts(request.body?.prompts)");
    expect(source).toContain("promptTexts: { ...(currentSession.promptTexts ?? {}), ...prompts }");
  });
});
