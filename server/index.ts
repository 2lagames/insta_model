import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import express from "express";
import type { ImportAsset, ImportItem } from "../src/lib/importTypes";
import { validateInstagramUrl } from "../src/lib/instagramUrl";
import { assertUniqueRunningHubBindings, normalizeRunningHubBindings } from "../src/lib/studioBindings";
import { ActivityLog } from "./activityLog";
import { ConnectionsStore, type ConnectionKeyName } from "./connectionsStore";
import { type PromptMediaInput } from "./ideogramPrompt";
import { ImportStore, normalizeCurrentSession } from "./importStore";
import { importInstagramUrl } from "./instagramImporter";
import { resolveImportMetadataPath } from "./localMetadata";
import { generateOllamaPrompt, listOllamaModels } from "./ollamaClient";
import { getActiveOllamaConfiguration } from "./ollamaConfiguration";
import { GenerationCancelledError, GenerationController, type GenerationOperation } from "./generationController";
import { cancelRunningHubTask, runRunningHubImageGeneration } from "./runningHub";

const port = Number(process.env.API_PORT ?? 4317);
const projectRoot = process.cwd();
const dataDir = join(projectRoot, "data");
const inputDir = join(projectRoot, "input");
const outputDir = join(projectRoot, "output");
const store = new ImportStore(dataDir);
const connectionsStore = new ConnectionsStore(dataDir);
const activityLog = new ActivityLog();
const generationController = new GenerationController(cancelRunningHubTask);

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/input", express.static(inputDir));
app.use("/output", express.static(outputDir));

app.get("/media/imports/:importId/apify-media.json", async (request, response) => {
  const metadataPath = resolveImportMetadataPath(dataDir, request.params.importId);
  if (!metadataPath) {
    response.sendStatus(404);
    return;
  }

  try {
    await access(metadataPath);
    response.sendFile(metadataPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      response.sendStatus(404);
      return;
    }
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    importProvider: "apify",
    version: "0.1.0"
  });
});

app.get("/api/events", (request, response) => {
  const unsubscribe = activityLog.subscribe(response);
  request.on("close", unsubscribe);
});

app.get("/api/imports", async (_request, response) => {
  try {
    const index = await store.readIndex();
    const session = normalizeCurrentSession(index);
    response.json({
      items: index.items,
      session,
      sessionItemIds: session.itemIds
    });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/imports/upload-image", express.raw({ type: "image/*", limit: "25mb" }), async (request, response) => {
  try {
    if (!request.is("image/*") || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "Choose a non-empty image file." });
      return;
    }
    const encodedFileName = String(request.header("X-File-Name") ?? "image");
    const fileName = basename(decodeURIComponent(encodedFileName));
    const extension = extname(fileName) || imageExtension(request.header("Content-Type") ?? "");
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folder = join(inputDir, "local", formatDateFolder(new Date()));
    await mkdir(folder, { recursive: true });
    const path = join(folder, `${id}${extension || ".png"}`);
    await writeFile(path, request.body);
    const imagePath = `/input/${relative(inputDir, path).replaceAll("\\", "/")}`;
    const item: ImportItem = { id, sourceUrl: `local://${fileName}`, mediaType: "image", status: "ready", createdAt: new Date().toISOString(), title: fileName, provider: "local", files: { image: imagePath }, assets: [{ id: "image", mediaType: "image", files: { image: imagePath } }] };
    await store.saveItem(item);
    const appendToSession = request.get("X-Append-To-Session") === "true";
    if (appendToSession) await store.appendToCurrentSession(item.id);
    else await store.startCurrentSession(item.id);
    response.json({ item, session: await store.readCurrentSession(), reused: false });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/connections", async (_request, response) => {
  try {
    response.json(await connectionsStore.readPublic());
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.put("/api/connections", async (request, response) => {
  try {
    await connectionsStore.save({
      ollamaProvider: request.body?.ollamaProvider === "cloud" || request.body?.ollamaProvider === "local"
        ? request.body.ollamaProvider
        : undefined,
      ollamaCloudModel: optionalString(request.body?.ollamaCloudModel),
      ollamaLocalModel: optionalString(request.body?.ollamaLocalModel),
      ollamaPromptInstruction: optionalString(request.body?.ollamaPromptInstruction),
      generationPrefixOptions: optionalString(request.body?.generationPrefixOptions),
      generationPrefixSelection: optionalString(request.body?.generationPrefixSelection),
      runningHubWorkflowId: optionalString(request.body?.runningHubWorkflowId),
      runningHubBindings: parseRunningHubBindings(request.body?.runningHubBindings)
    });
    response.json(await connectionsStore.readPublic());
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.put("/api/connections/keys/:keyName", async (request, response) => {
  try {
    const keyName = parseConnectionKeyName(request.params.keyName);
    await connectionsStore.saveKey(keyName, optionalString(request.body?.key) ?? "");
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: toErrorMessage(error) });
  }
});

app.delete("/api/connections/keys/:keyName", async (request, response) => {
  try {
    const keyName = parseConnectionKeyName(request.params.keyName);
    await connectionsStore.clearKey(keyName);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/ollama/models", async (request, response) => {
  const provider = request.query.provider === "cloud" ? "cloud" : "local";

  try {
    const connections = await connectionsStore.readPrivate();
    if (provider === "cloud" && !connections.ollamaCloudApiKey?.trim()) {
      response.status(400).json({ error: "Ollama Cloud API key is required." });
      return;
    }
    response.json({ models: await listOllamaModels({ provider, apiKey: connections.ollamaCloudApiKey }) });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/imports", async (request, response) => {
  const url = String(request.body?.url ?? "");
  const forceRefresh = request.body?.forceRefresh === true;
  const validation = validateInstagramUrl(url);

  if (!validation.ok) {
    response.status(400).json({ error: validation.message });
    return;
  }
  try {
    activityLog.publish({ tone: "running", source: "import", message: `Import started: ${validation.url}` });
    if (!forceRefresh) {
      const reusableItem = await store.findNewestReusableBySourceUrl(validation.url);
      if (reusableItem) {
        await store.startCurrentSession(reusableItem.id);
        const session = await store.readCurrentSession();
        activityLog.publish({ tone: "ready", source: "import", message: "Using previously downloaded media." });
        response.json({ item: reusableItem, session, reused: true });
        return;
      }
    }

    const connections = await connectionsStore.readPrivate();
    const item = await importInstagramUrl(validation.url, {
      dataDir,
      inputDir,
      apifyApiToken: connections.apifyApiToken ?? ""
    });
    await store.saveItem(item);
    await store.startCurrentSession(item.id);
    const session = await store.readCurrentSession();
    activityLog.publish({ tone: "ready", source: "import", message: `Import complete: ${item.assets.length} asset(s).` });
    response.json({ item, session, reused: false });
  } catch (error) {
    activityLog.publish({ tone: "error", source: "import", message: toErrorMessage(error) });
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/imports/cleanup", async (_request, response) => {
  try {
    const result = await store.cleanupDuplicateInstagramImports();
    const session = await store.readCurrentSession();
    const items = await store.listItems();
    activityLog.publish({
      tone: "ready",
      source: "ui",
      message: result.deletedItemIds.length > 0
        ? `Removed ${result.deletedItemIds.length} duplicate import(s).`
        : "No duplicate imports were found."
    });
    response.json({ ...result, items, session, sessionItemIds: session.itemIds });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/imports/session/reset", async (_request, response) => {
  try {
    await store.resetCurrentSession();
    const session = await store.readCurrentSession();
    activityLog.publish({ tone: "ready", source: "ui", message: "Media session reset. Local files were not deleted." });
    response.json({ ok: true, session, sessionItemIds: session.itemIds });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.put("/api/imports/session/prompts", async (request, response) => {
  try {
    const prompts = parsePromptTexts(request.body?.prompts);
    const currentSession = await store.readCurrentSession();
    const session = {
      ...currentSession,
      promptTexts: { ...(currentSession.promptTexts ?? {}), ...prompts }
    };
    await store.writeCurrentSession(session);
    response.json({ session });
  } catch (error) {
    response.status(400).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/open-imports-folder", async (_request, response) => {
  try {
    await mkdir(outputDir, { recursive: true });
    const { spawn } = await import("node:child_process");
    spawn("open", [outputDir], { detached: true, stdio: "ignore" }).unref();
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/generation/image-prompts", async (request, response) => {
  let generation: GenerationOperation | undefined;
  try {
    const media = parsePromptMedia(request.body?.media);
    generation = generationController.start();
    const connections = await connectionsStore.readPrivate();
    const ollama = getActiveOllamaConfiguration(connections);
    activityLog.publish({
      tone: "running",
      source: "prompt",
      message: `Image prompt generation started for ${media.length} media item(s).`
    });
    const prompts = [];
    for (const [index, mediaItem] of media.entries()) {
      generation.throwIfCancelled();
      activityLog.publish({
        tone: "running",
        source: "prompt",
        message: `Sending ${mediaItem.label} (${index + 1}/${media.length}) to ${ollama.provider} Ollama.`
      });
      const generatedPrompt = {
        mediaId: mediaItem.id,
        label: mediaItem.label,
        prompt: await generateOllamaPrompt({
          provider: ollama.provider,
          apiKey: ollama.apiKey,
          model: ollama.model,
          prompt: ollama.instruction,
          imageBase64: await readFile(resolveStudioMediaPath(mediaItem.imagePath), "base64"),
          signal: generation.signal
        })
      };
      generation.throwIfCancelled();
      prompts.push(generatedPrompt);
      activityLog.publish({
        tone: "ready",
        source: "prompt",
        message: `Generated prompt for ${mediaItem.label} (${index + 1}/${media.length}).`
      });
      activityLog.publish({
        tone: "ready",
        source: "prompt",
        message: generatedPrompt.prompt
      });
    }
    const currentSession = await store.readCurrentSession();
    const session = { ...currentSession, promptTexts: { ...(currentSession.promptTexts ?? {}), ...Object.fromEntries(prompts.map((item) => [item.mediaId, item.prompt])) } };
    await store.writeCurrentSession(session);
    response.json({ prompts, session });
  } catch (error) {
    if (isGenerationCancelled(error, generation)) {
      activityLog.publish({ tone: "ready", source: "prompt", message: "Prompt generation cancelled." });
      response.status(499).json({ error: "Generation cancelled." });
    } else {
      activityLog.publish({ tone: "error", source: "prompt", message: toErrorMessage(error) });
      response.status(500).json({ error: toErrorMessage(error) });
    }
  } finally {
    if (generation) {
      generationController.finish(generation);
    }
  }
});

app.post("/api/generation/images", async (request, response) => {
  let generation: GenerationOperation | undefined;
  try {
    const jobs = parseRunningHubPromptJobs(request.body?.jobs);
    const activeGeneration = generationController.start();
    generation = activeGeneration;
    const connections = await connectionsStore.readPrivate();
    const currentSession = await store.readCurrentSession();
    activityLog.publish({
      tone: "running",
      source: "generation",
      message: `RunningHub image generation started for ${jobs.length} media item(s).`
    });

    const runningHubResult = await runRunningHubImageGeneration({
      outputDir,
      config: {
        apiKey: connections.runningHubApiKey ?? "",
        workflowId: connections.runningHubWorkflowId ?? "",
        bindings: normalizeRunningHubBindings(connections.runningHubBindings),
        promptNodeId: connections.runningHubPromptNodeId,
        promptFieldName: connections.runningHubPromptFieldName,
        imageNodeId: connections.runningHubImageNodeId,
        imageFieldName: connections.runningHubImageFieldName
      },
      jobs: jobs.map((job) => ({
        mediaId: job.media.id,
        label: job.media.label,
        imagePath: job.media.generatedImagePath ? undefined : resolveStudioMediaPath(job.media.imagePath),
        videoPath: job.media.videoPath ? resolveStudioMediaPath(job.media.videoPath) : undefined,
        generatedImagePath: job.media.generatedImagePath ? resolveStudioMediaPath(job.media.generatedImagePath) : undefined,
        prompt: job.prompt
      })),
      onStatus: (event) => activityLog.publish(event),
      signal: activeGeneration.signal,
      onTaskCreated: (taskId) => activeGeneration.registerRunningHubTask({
        apiKey: connections.runningHubApiKey ?? "",
        taskId
      })
    });
    generation.throwIfCancelled();
    await store.saveItem(runningHubResult.item);
    await store.appendToCurrentSession(runningHubResult.item.id, {
      sceneBibles: currentSession.sceneBibles,
      mediaSceneMap: {
        ...currentSession.mediaSceneMap,
        ...mapGeneratedAssetsToScenes(runningHubResult.item, runningHubResult.assets, jobs.map((job) => job.media), currentSession.mediaSceneMap)
      }
    });
    const session = await store.readCurrentSession();
    response.json({ item: runningHubResult.item, session });
  } catch (error) {
    if (isGenerationCancelled(error, generation)) {
      activityLog.publish({ tone: "ready", source: "generation", message: "Image generation cancelled." });
      response.status(499).json({ error: "Generation cancelled." });
    } else {
      activityLog.publish({ tone: "error", source: "generation", message: toErrorMessage(error) });
      response.status(500).json({ error: toErrorMessage(error) });
    }
  } finally {
    if (generation) {
      generationController.finish(generation);
    }
  }
});

app.post("/api/generation/cancel", async (_request, response) => {
  const cancelled = await generationController.cancel();
  activityLog.publish({
    tone: "ready",
    source: "generation",
    message: cancelled ? "Generation cancellation requested." : "No active generation to cancel."
  });
  response.json({ cancelled });
});

const host = process.env.API_HOST ?? "127.0.0.1";

const httpServer = app.listen(port, host, () => {
  console.log(`Import API listening on http://localhost:${port}`);
});

httpServer.on("error", (error) => {
  console.error(`Import API failed: ${toErrorMessage(error)}`);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatDateFolder(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function imageExtension(contentType: string): string {
  return contentType === "image/jpeg" ? ".jpg" : contentType === "image/webp" ? ".webp" : contentType === "image/gif" ? ".gif" : ".png";
}

function isGenerationCancelled(error: unknown, generation: { signal: AbortSignal } | undefined): boolean {
  return generation?.signal.aborted === true
    || error instanceof GenerationCancelledError
    || (error instanceof DOMException && error.name === "AbortError");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseRunningHubBindings(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const bindings = normalizeRunningHubBindings(value);
  assertUniqueRunningHubBindings(bindings);
  return bindings;
}

function parseConnectionKeyName(value: unknown): ConnectionKeyName {
  if (value === "apifyApiToken" || value === "ollamaCloudApiKey" || value === "runningHubApiKey") {
    return value;
  }
  throw new Error("Unknown connection key.");
}

function resolveStudioMediaPath(mediaPath: string): string {
  const permittedRoots = [
    { publicPrefix: "/input/", localRoot: inputDir },
    { publicPrefix: "/output/", localRoot: outputDir }
  ];
  const permittedRoot = permittedRoots.find((candidate) => mediaPath.startsWith(candidate.publicPrefix));
  if (!permittedRoot) {
    throw new Error("Studio media must reference a local input or output file.");
  }
  const resolvedPath = resolve(permittedRoot.localRoot, mediaPath.slice(permittedRoot.publicPrefix.length));
  const pathFromRoot = relative(permittedRoot.localRoot, resolvedPath);
  if (pathFromRoot.startsWith("..") || pathFromRoot === "") {
    throw new Error("Studio media path must stay inside the permitted local folder.");
  }
  return resolvedPath;
}

function mapGeneratedAssetsToScenes(
  generatedItem: ImportItem,
  generatedAssets: ImportAsset[],
  sourceMedia: PromptMediaInput[],
  sourceMediaSceneMap: Record<string, string>
): Record<string, string> {
  const generatedMap: Record<string, string> = {};
  if (sourceMedia.length === 0) {
    return generatedMap;
  }

  const fallbackSceneId = sourceMediaSceneMap[sourceMedia[0].id];
  for (const [index, asset] of generatedAssets.entries()) {
    const sourceIndex = Math.min(index, sourceMedia.length - 1);
    const sceneId = sourceMediaSceneMap[sourceMedia[sourceIndex].id] ?? fallbackSceneId;
    if (!sceneId) {
      continue;
    }
    generatedMap[`${generatedItem.id}:${asset.id}:image`] = sceneId;
  }
  return generatedMap;
}

function parsePromptMedia(value: unknown): PromptMediaInput[] {
  if (!Array.isArray(value)) {
    throw new Error("Prompt generation requires a media array.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Prompt media item ${index + 1} is invalid.`);
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const label = typeof record.label === "string" ? record.label : "";
    const imagePath = typeof record.imagePath === "string" ? record.imagePath : "";
    const videoPath = typeof record.videoPath === "string" ? record.videoPath : undefined;
    const generatedImagePath = typeof record.generatedImagePath === "string" ? record.generatedImagePath : undefined;
    const sourceKind = record.sourceKind === "video-first-frame" ? "video-first-frame" : "photo";
    const caption = typeof record.caption === "string" ? record.caption : undefined;

    if (!id || !label || !imagePath) {
      throw new Error(`Prompt media item ${index + 1} must include id, label, and imagePath.`);
    }

    return { id, label, imagePath, videoPath, generatedImagePath, sourceKind, caption };
  });
}

function parsePromptTexts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prompts must be an object with string values.");
  }

  const prompts: Record<string, string> = {};
  for (const [mediaId, prompt] of Object.entries(value)) {
    if (typeof prompt !== "string") {
      throw new Error("prompts must be an object with string values.");
    }
    prompts[mediaId] = prompt;
  }
  return prompts;
}

function parseRunningHubPromptJobs(value: unknown): Array<{ media: PromptMediaInput; prompt: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Image generation requires at least one media and prompt job.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Image generation job ${index + 1} is invalid.`);
    }
    const record = item as Record<string, unknown>;
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (!prompt) {
      throw new Error(`Image generation job ${index + 1} must include a non-empty prompt.`);
    }
    const [media] = parsePromptMedia([record.media]);
    return { media, prompt };
  });
}
