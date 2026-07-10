import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import type { CurrentMediaSession, ImportAsset, ImportItem, SceneBible } from "../src/lib/importTypes";
import { validateInstagramUrl } from "../src/lib/instagramUrl";
import { ActivityLog } from "./activityLog";
import { ConnectionsStore } from "./connectionsStore";
import { defaultOllamaModel, generateIdeogramPromptForMedia, type PromptMediaInput } from "./ideogramPrompt";
import { ImportStore, normalizeCurrentSession } from "./importStore";
import { checkScrapeCreatorsPostAccess, importInstagramUrl } from "./instagramImporter";
import { runRunningHubImageGeneration, type RunningHubPromptJob } from "./runningHub";
import { createFallbackSceneData, generateSceneBiblesForImport } from "./sceneBible";

const port = Number(process.env.API_PORT ?? 4317);
const projectRoot = process.cwd();
const dataDir = join(projectRoot, "data");
const inputDir = join(projectRoot, "input");
const outputDir = join(projectRoot, "output");
const store = new ImportStore(dataDir);
const connectionsStore = new ConnectionsStore(dataDir);
const activityLog = new ActivityLog();

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/media", express.static(dataDir));
app.use("/input", express.static(inputDir));
app.use("/output", express.static(outputDir));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    importProvider: "scrapecreators",
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
      scrapeCreatorsApiKey: String(request.body?.scrapeCreatorsApiKey ?? ""),
      runningHubApiKey: String(request.body?.runningHubApiKey ?? ""),
      runningHubWorkflowId: String(request.body?.runningHubWorkflowId ?? ""),
      runningHubPromptNodeId: String(request.body?.runningHubPromptNodeId ?? ""),
      runningHubPromptFieldName: String(request.body?.runningHubPromptFieldName ?? ""),
      runningHubWorkflowFileName: String(request.body?.runningHubWorkflowFileName ?? ""),
      runningHubWorkflowJson: String(request.body?.runningHubWorkflowJson ?? "")
    });
    response.json(await connectionsStore.readPublic());
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
      scrapeCreatorsApiKey: connections.scrapeCreatorsApiKey ?? ""
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

app.post("/api/imports/check", async (request, response) => {
  const url = String(request.body?.url ?? "");
  const validation = validateInstagramUrl(url);

  if (!validation.ok) {
    response.status(400).json({ error: validation.message });
    return;
  }

  try {
    const connections = await connectionsStore.readPrivate();
    const result = await checkScrapeCreatorsPostAccess(validation.url, connections.scrapeCreatorsApiKey ?? "");
    response.json({
      ok: true,
      sourceUrl: result.sourceUrl,
      provider: "scrapecreators"
    });
  } catch (error) {
    response.status(422).json({
      ok: false,
      sourceUrl: validation.url,
      provider: "scrapecreators",
      error: toErrorMessage(error)
    });
  }
});

app.post("/api/open-imports-folder", async (_request, response) => {
  try {
    await mkdir(inputDir, { recursive: true });
    const { spawn } = await import("node:child_process");
    spawn("open", [inputDir], { detached: true, stdio: "ignore" }).unref();
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/generation/image-prompts", async (request, response) => {
  try {
    const media = parsePromptMedia(request.body?.media);
    activityLog.publish({
      tone: "running",
      source: "prompt",
      message: `Image prompt generation started for ${media.length} media item(s).`
    });
    const { media: mediaWithScenes, session } = await ensureSceneBiblesForPromptMedia(media);
    const prompt = await generateIdeogramPromptForMedia({
      inputDir,
      model: defaultOllamaModel,
      media: mediaWithScenes,
      onStatus: (event) => activityLog.publish(event)
    });
    activityLog.publish({
      tone: "ready",
      source: "prompt",
      message: "Ideogram JSON prompt"
    });
    activityLog.publish({
      tone: "ready",
      source: "prompt",
      message: prompt
    });
    response.json({ prompt, session });
  } catch (error) {
    activityLog.publish({ tone: "error", source: "prompt", message: toErrorMessage(error) });
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/generation/images", async (request, response) => {
  try {
    const media = parsePromptMedia(request.body?.media);
    const connections = await connectionsStore.readPrivate();
    activityLog.publish({
      tone: "running",
      source: "prompt",
      message: `Image prompt generation started for ${media.length} media item(s).`
    });
    const { media: mediaWithScenes, session: currentSession } = await ensureSceneBiblesForPromptMedia(media);
    const prompt = await generateIdeogramPromptForMedia({
      inputDir,
      model: defaultOllamaModel,
      media: mediaWithScenes,
      onStatus: (event) => activityLog.publish(event)
    });
    activityLog.publish({
      tone: "ready",
      source: "prompt",
      message: prompt
    });

    const runningHubResult = await runRunningHubImageGeneration({
      outputDir,
      config: {
        apiKey: connections.runningHubApiKey ?? "",
        workflowId: connections.runningHubWorkflowId ?? "",
        promptNodeId: connections.runningHubPromptNodeId ?? "",
        promptFieldName: connections.runningHubPromptFieldName ?? "text",
        workflowJson: connections.runningHubWorkflowJson
      },
      jobs: createRunningHubPromptJobs(mediaWithScenes, prompt),
      onStatus: (event) => activityLog.publish(event)
    });
    await store.saveItem(runningHubResult.item);
    await store.appendToCurrentSession(runningHubResult.item.id, {
      sceneBibles: currentSession.sceneBibles,
      mediaSceneMap: {
        ...currentSession.mediaSceneMap,
        ...mapGeneratedAssetsToScenes(runningHubResult.item, runningHubResult.assets, mediaWithScenes, currentSession.mediaSceneMap)
      }
    });
    const session = await store.readCurrentSession();
    response.json({ prompt, item: runningHubResult.item, session });
  } catch (error) {
    activityLog.publish({ tone: "error", source: "generation", message: toErrorMessage(error) });
    response.status(500).json({ error: toErrorMessage(error) });
  }
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

async function ensureSceneBiblesForPromptMedia(media: PromptMediaInput[]): Promise<{ media: PromptMediaInput[]; session: CurrentMediaSession }> {
  const currentSession = await store.readCurrentSession();
  const sceneById = new Map(currentSession.sceneBibles.map((scene) => [scene.id, scene]));
  const mediaWithKnownScenes = media.map((item) => {
    const sceneId = item.sceneBibleId ?? currentSession.mediaSceneMap[item.id];
    const sceneBible = item.sceneBible ?? (sceneId ? sceneById.get(sceneId) : undefined);
    return sceneBible ? { ...item, sceneBibleId: sceneBible.id, sceneBible } : item;
  });
  const mediaMissingScenes = mediaWithKnownScenes.filter((item) => !item.sceneBible);

  if (mediaMissingScenes.length === 0) {
    return { media: mediaWithKnownScenes, session: currentSession };
  }

  activityLog.publish({
    tone: "running",
    source: "scene",
    message: `Preparing scene bible for ${mediaMissingScenes.length} selected media item(s).`
  });
  const sceneData = await generateSceneBiblesForPromptMedia(mediaMissingScenes);
  const nextSceneBibles = mergeSceneBibles(currentSession.sceneBibles, sceneData.sceneBibles);
  const nextSession: CurrentMediaSession = {
    itemIds: currentSession.itemIds,
    sceneBibles: nextSceneBibles,
    mediaSceneMap: {
      ...currentSession.mediaSceneMap,
      ...sceneData.mediaSceneMap
    }
  };
  await store.writeCurrentSession(nextSession);

  const nextSceneById = new Map(nextSceneBibles.map((scene) => [scene.id, scene]));
  return {
    session: nextSession,
    media: mediaWithKnownScenes.map((item) => {
      const sceneId = item.sceneBibleId ?? nextSession.mediaSceneMap[item.id];
      const sceneBible = item.sceneBible ?? (sceneId ? nextSceneById.get(sceneId) : undefined);
      return sceneBible ? { ...item, sceneBibleId: sceneBible.id, sceneBible } : item;
    })
  };
}

function mergeSceneBibles(existing: SceneBible[], incoming: SceneBible[]): SceneBible[] {
  const byId = new Map(existing.map((scene) => [scene.id, scene]));
  for (const scene of incoming) {
    byId.set(scene.id, scene);
  }
  return [...byId.values()];
}

async function generateSceneBiblesForPromptMedia(media: PromptMediaInput[]): Promise<Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap">> {
  if (media.length === 0) {
    return { sceneBibles: [], mediaSceneMap: {} };
  }

  try {
    return await generateSceneBiblesForImport({
      inputDir,
      model: defaultOllamaModel,
      media,
      onStatus: (event) => activityLog.publish(event)
    });
  } catch (error) {
    activityLog.publish({
      tone: "error",
      source: "scene",
      message: `Scene analysis failed: ${toErrorMessage(error)}. Using fallback scene bible.`
    });
    return createFallbackSceneData(media);
  }
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
    const sourceKind = record.sourceKind === "video-first-frame" ? "video-first-frame" : "photo";
    const caption = typeof record.caption === "string" ? record.caption : undefined;
    const sceneBibleId = typeof record.sceneBibleId === "string" ? record.sceneBibleId : undefined;
    const sceneBible = parseSceneBible(record.sceneBible);

    if (!id || !label || !imagePath) {
      throw new Error(`Prompt media item ${index + 1} must include id, label, and imagePath.`);
    }

    return { id, label, imagePath, sourceKind, caption, sceneBibleId, sceneBible };
  });
}

function parseSceneBible(value: unknown): SceneBible | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Partial<SceneBible>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !Array.isArray(record.sourceMediaIds) ||
    !record.locationSignature ||
    typeof record.locationSignature !== "object" ||
    !record.lockedJson ||
    typeof record.lockedJson !== "object"
  ) {
    return undefined;
  }
  return record as SceneBible;
}

function createRunningHubPromptJobs(media: PromptMediaInput[], prompt: string): RunningHubPromptJob[] {
  if (media.length === 1) {
    return [{
      mediaId: media[0].id,
      label: media[0].label,
      prompt
    }];
  }

  const parsed = JSON.parse(prompt) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a prompt array for multi-media image generation.");
  }

  return media.map((mediaItem, index) => {
    const promptRecord = parsed[index];
    if (!promptRecord || typeof promptRecord !== "object") {
      throw new Error(`Missing generated prompt for ${mediaItem.label} (${index + 1}/${media.length}).`);
    }
    const record = promptRecord as Record<string, unknown>;
    const promptValue = record.prompt ?? promptRecord;
    return {
      mediaId: mediaItem.id,
      label: mediaItem.label,
      prompt: typeof promptValue === "string" ? promptValue : JSON.stringify(promptValue, null, 2)
    };
  });
}
