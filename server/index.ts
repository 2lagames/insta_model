import { mkdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import express from "express";
import type { ImportAsset, ImportItem } from "../src/lib/importTypes";
import { validateInstagramUrl } from "../src/lib/instagramUrl";
import { ActivityLog } from "./activityLog";
import { ConnectionsStore, type ConnectionKeyName } from "./connectionsStore";
import { defaultPromptInstruction, type PromptMediaInput } from "./ideogramPrompt";
import { ImportStore, normalizeCurrentSession } from "./importStore";
import { checkScrapeCreatorsPostAccess, importInstagramUrl } from "./instagramImporter";
import { generateOllamaPrompt, listOllamaModels } from "./ollamaClient";
import { runRunningHubImageGeneration } from "./runningHub";

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
      scrapeCreatorsApiKey: optionalString(request.body?.scrapeCreatorsApiKey),
      ollamaCloudApiKey: optionalString(request.body?.ollamaCloudApiKey),
      ollamaProvider: request.body?.ollamaProvider === "cloud" || request.body?.ollamaProvider === "local"
        ? request.body.ollamaProvider
        : undefined,
      ollamaCloudModel: optionalString(request.body?.ollamaCloudModel),
      ollamaLocalModel: optionalString(request.body?.ollamaLocalModel),
      ollamaPromptInstruction: optionalString(request.body?.ollamaPromptInstruction),
      runningHubApiKey: optionalString(request.body?.runningHubApiKey),
      runningHubWorkflowId: optionalString(request.body?.runningHubWorkflowId),
      runningHubPromptNodeId: optionalString(request.body?.runningHubPromptNodeId),
      runningHubPromptFieldName: optionalString(request.body?.runningHubPromptFieldName),
      runningHubImageNodeId: optionalString(request.body?.runningHubImageNodeId),
      runningHubImageFieldName: optionalString(request.body?.runningHubImageFieldName)
    });
    response.json(await connectionsStore.readPublic());
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/connections/keys/:keyName", async (request, response) => {
  try {
    const keyName = parseConnectionKeyName(request.params.keyName);
    response.json({ key: await connectionsStore.readKey(keyName) ?? "" });
  } catch (error) {
    response.status(400).json({ error: toErrorMessage(error) });
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
    const connections = await connectionsStore.readPrivate();
    const ollama = getActiveOllamaConfiguration(connections);
    activityLog.publish({
      tone: "running",
      source: "prompt",
      message: `Image prompt generation started for ${media.length} media item(s).`
    });
    const prompts = [];
    for (const [index, mediaItem] of media.entries()) {
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
          imageBase64: await readFile(resolvePromptMediaImagePath(mediaItem.imagePath), "base64")
        })
      };
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
    const session = await store.readCurrentSession();
    response.json({ prompts, session });
  } catch (error) {
    activityLog.publish({ tone: "error", source: "prompt", message: toErrorMessage(error) });
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/generation/images", async (request, response) => {
  try {
    const jobs = parseRunningHubPromptJobs(request.body?.jobs);
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
        promptNodeId: connections.runningHubPromptNodeId ?? "",
        promptFieldName: connections.runningHubPromptFieldName ?? "text",
        imageNodeId: connections.runningHubImageNodeId ?? "",
        imageFieldName: connections.runningHubImageFieldName ?? "image"
      },
      jobs: jobs.map((job) => ({
        mediaId: job.media.id,
        label: job.media.label,
        imagePath: resolvePromptMediaImagePath(job.media.imagePath),
        prompt: job.prompt
      })),
      onStatus: (event) => activityLog.publish(event)
    });
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseConnectionKeyName(value: unknown): ConnectionKeyName {
  if (value === "scrapeCreatorsApiKey" || value === "ollamaCloudApiKey" || value === "runningHubApiKey") {
    return value;
  }
  throw new Error("Unknown connection key.");
}

function getActiveOllamaConfiguration(connections: Awaited<ReturnType<ConnectionsStore["readPrivate"]>>): {
  provider: "cloud" | "local";
  apiKey?: string;
  model: string;
  instruction: string;
} {
  const provider = connections.ollamaProvider ?? "local";
  const model = provider === "cloud" ? connections.ollamaCloudModel : connections.ollamaLocalModel;
  if (!model?.trim()) {
    throw new Error(`Select an Ollama ${provider === "cloud" ? "Cloud" : "local"} model on the Подключения tab before prompt generation.`);
  }
  if (provider === "cloud" && !connections.ollamaCloudApiKey?.trim()) {
    throw new Error("Add Ollama Cloud API key on the Подключения tab before prompt generation.");
  }
  if (!connections.ollamaPromptInstruction?.trim() && !defaultPromptInstruction.trim()) {
    throw new Error("Add a prompt instruction on the Подключения tab before prompt generation.");
  }
  return {
    provider,
    apiKey: connections.ollamaCloudApiKey,
    model,
    instruction: connections.ollamaPromptInstruction?.trim() || defaultPromptInstruction
  };
}

function resolvePromptMediaImagePath(imagePath: string): string {
  const inputPrefix = "/input/";
  if (!imagePath.startsWith(inputPrefix)) {
    throw new Error("Selected media image must come from the local input folder.");
  }
  const resolvedPath = resolve(inputDir, imagePath.slice(inputPrefix.length));
  const pathFromInput = relative(inputDir, resolvedPath);
  if (pathFromInput.startsWith("..") || pathFromInput === "") {
    throw new Error("Selected media image must stay inside the local input folder.");
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
    const sourceKind = record.sourceKind === "video-first-frame" ? "video-first-frame" : "photo";
    const caption = typeof record.caption === "string" ? record.caption : undefined;

    if (!id || !label || !imagePath) {
      throw new Error(`Prompt media item ${index + 1} must include id, label, and imagePath.`);
    }

    return { id, label, imagePath, sourceKind, caption };
  });
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
