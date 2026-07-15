import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsStore } from "./connectionsStore";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "connections-store-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ConnectionsStore", () => {
  it("returns no public key data when the local file is missing", async () => {
    const store = new ConnectionsStore(tempDir);

    await expect(store.readPublic()).resolves.toEqual({
      hasScrapeCreatorsApiKey: false,
      hasOllamaCloudApiKey: false,
      hasRunningHubApiKey: false,
      hasRunningHubWorkflow: false
    });
  });

  it("stores the ScrapeCreators API key locally and exposes only a preview", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({ scrapeCreatorsApiKey: "fake_scrapecreators_key_1234567890" });

    await expect(store.readPrivate()).resolves.toEqual({
      scrapeCreatorsApiKey: "fake_scrapecreators_key_1234567890"
    });
    await expect(store.readPublic()).resolves.toEqual({
      hasScrapeCreatorsApiKey: true,
      scrapeCreatorsApiKeyPreview: "******************************7890",
      hasOllamaCloudApiKey: false,
      hasRunningHubApiKey: false,
      hasRunningHubWorkflow: false
    });

    const raw = await readFile(join(tempDir, "connections.local.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ scrapeCreatorsApiKey: "fake_scrapecreators_key_1234567890" });
  });

  it("stores RunningHub credentials and workflow JSON locally without exposing secrets publicly", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({
      scrapeCreatorsApiKey: "fake_scrapecreators_key_1234567890",
      runningHubApiKey: "rh_secret_abcdef1234567890",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text",
      runningHubWorkflowFileName: "ideogram-api.json",
      runningHubWorkflowJson: "{\"6\":{\"inputs\":{\"text\":\"old prompt\"}}}"
    });

    await expect(store.readPrivate()).resolves.toEqual({
      scrapeCreatorsApiKey: "fake_scrapecreators_key_1234567890",
      runningHubApiKey: "rh_secret_abcdef1234567890",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text",
      runningHubWorkflowFileName: "ideogram-api.json",
      runningHubWorkflowJson: "{\"6\":{\"inputs\":{\"text\":\"old prompt\"}}}"
    });
    await expect(store.readPublic()).resolves.toEqual({
      hasScrapeCreatorsApiKey: true,
      scrapeCreatorsApiKeyPreview: "******************************7890",
      hasOllamaCloudApiKey: false,
      hasRunningHubApiKey: true,
      runningHubApiKeyPreview: "**********************7890",
      hasRunningHubWorkflow: true,
      runningHubWorkflowFileName: "ideogram-api.json",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text"
    });
  });

  it("stores Ollama provider settings and clears only the requested API key", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({
      scrapeCreatorsApiKey: "scrape-key",
      ollamaCloudApiKey: "cloud-key",
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaLocalModel: "qwen2.5vl:7b",
      ollamaPromptInstruction: "Describe the image.",
      runningHubImageNodeId: "12",
      runningHubImageFieldName: "image"
    });
    await store.clearKey("ollamaCloudApiKey");

    await expect(store.readPrivate()).resolves.toEqual({
      scrapeCreatorsApiKey: "scrape-key",
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaLocalModel: "qwen2.5vl:7b",
      ollamaPromptInstruction: "Describe the image.",
      runningHubImageNodeId: "12",
      runningHubImageFieldName: "image"
    });
    await expect(store.readPublic()).resolves.toMatchObject({
      hasScrapeCreatorsApiKey: true,
      hasOllamaCloudApiKey: false,
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaLocalModel: "qwen2.5vl:7b",
      ollamaPromptInstruction: "Describe the image.",
      runningHubImageNodeId: "12",
      runningHubImageFieldName: "image"
    });
  });

  it("updates a selected secret key without changing provider settings", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({ ollamaProvider: "local", ollamaLocalModel: "gemma3" });

    await store.saveKey("ollamaCloudApiKey", " cloud-key ");

    await expect(store.readPrivate()).resolves.toEqual({
      ollamaCloudApiKey: "cloud-key",
      ollamaProvider: "local",
      ollamaLocalModel: "gemma3"
    });
  });

  it("reads only the selected API key for a key editor", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({
      scrapeCreatorsApiKey: "scrape-key",
      ollamaCloudApiKey: "cloud-key",
      runningHubApiKey: "runninghub-key"
    });

    await expect(store.readKey("ollamaCloudApiKey")).resolves.toBe("cloud-key");
  });

  it("clears a selected API key when its key editor saves a blank value", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({ ollamaCloudApiKey: "cloud-key", ollamaProvider: "cloud" });

    await store.saveKey("ollamaCloudApiKey", "   ");

    await expect(store.readPrivate()).resolves.toEqual({ ollamaProvider: "cloud" });
  });

  it("keeps saved provider settings when an older caller saves only its own connection fields", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaPromptInstruction: "Describe the image."
    });

    await store.save({ runningHubWorkflowId: "workflow-1" });

    await expect(store.readPrivate()).resolves.toEqual({
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaPromptInstruction: "Describe the image.",
      runningHubWorkflowId: "workflow-1"
    });
  });
});
