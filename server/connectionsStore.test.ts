import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsStore } from "./connectionsStore";
import { defaultPromptInstruction } from "./ideogramPrompt";

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
      hasApifyApiToken: false,
      hasOllamaCloudApiKey: false,
      ollamaPromptInstruction: defaultPromptInstruction,
      hasRunningHubApiKey: false
    });
  });

  it("stores the Apify API token locally and exposes only a preview", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({ apifyApiToken: "apify_token_1234567890" });

    await expect(store.readPrivate()).resolves.toEqual({
      apifyApiToken: "apify_token_1234567890"
    });
    await expect(store.readPublic()).resolves.toEqual({
      hasApifyApiToken: true,
      apifyApiTokenPreview: "******************7890",
      hasOllamaCloudApiKey: false,
      ollamaPromptInstruction: defaultPromptInstruction,
      hasRunningHubApiKey: false
    });

    const raw = await readFile(join(tempDir, "connections.local.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ apifyApiToken: "apify_token_1234567890" });
  });

  it.runIf(process.platform !== "win32")("creates and repairs the private file with owner-only permissions", async () => {
    const filePath = join(tempDir, "connections.local.json");
    await writeFile(filePath, JSON.stringify({ apifyApiToken: "private-key" }), { mode: 0o644 });
    const store = new ConnectionsStore(tempDir);

    await store.readPrivate();

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("stores RunningHub credentials and node configuration without workflow JSON", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({
      apifyApiToken: "apify_token_1234567890",
      runningHubApiKey: "rh_secret_abcdef1234567890",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text"
    });

    await expect(store.readPrivate()).resolves.toEqual({
      apifyApiToken: "apify_token_1234567890",
      runningHubApiKey: "rh_secret_abcdef1234567890",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text"
    });
    await expect(store.readPublic()).resolves.toEqual({
      hasApifyApiToken: true,
      apifyApiTokenPreview: "******************7890",
      hasOllamaCloudApiKey: false,
      ollamaPromptInstruction: defaultPromptInstruction,
      hasRunningHubApiKey: true,
      runningHubApiKeyPreview: "**********************7890",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text",
      runningHubBindings: [{ nodeId: "6", fieldName: "text", studioId: "2" }]
    });
  });

  it("exposes legacy image and prompt settings as configurable Studio ID bindings", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({
      runningHubImageNodeId: "39",
      runningHubImageFieldName: "image",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text"
    });

    await expect(store.readPublic()).resolves.toMatchObject({
      runningHubBindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "6", fieldName: "text", studioId: "2" }
      ]
    });

    await store.save({ runningHubBindings: [{ nodeId: "44", fieldName: "image", studioId: "4" }] });

    await expect(store.readPrivate()).resolves.toEqual({
      runningHubBindings: [{ nodeId: "44", fieldName: "image", studioId: "4" }]
    });
  });

  it("persists a configurable list of RunningHub Studio ID bindings", async () => {
    const store = new ConnectionsStore(tempDir);
    const runningHubBindings = [
      { nodeId: "39", fieldName: "image", studioId: "1" as const },
      { nodeId: "18", fieldName: "video", studioId: "3" as const },
      { nodeId: "6", fieldName: "text", studioId: "2" as const }
    ];

    await store.save({ runningHubBindings });

    await expect(store.readPrivate()).resolves.toMatchObject({ runningHubBindings });
    await expect(store.readPublic()).resolves.toMatchObject({ runningHubBindings });
  });

  it("stores Ollama provider settings and clears only the requested API key", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({
      apifyApiToken: "apify-token",
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
      apifyApiToken: "apify-token",
      ollamaProvider: "cloud",
      ollamaCloudModel: "gemma3",
      ollamaLocalModel: "qwen2.5vl:7b",
      ollamaPromptInstruction: "Describe the image.",
      runningHubImageNodeId: "12",
      runningHubImageFieldName: "image"
    });
    await expect(store.readPublic()).resolves.toMatchObject({
      hasApifyApiToken: true,
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

  it("rejects a blank key replacement without clearing the saved key", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({ ollamaCloudApiKey: "cloud-key", ollamaProvider: "cloud" });

    await expect(store.saveKey("ollamaCloudApiKey", "   ")).rejects.toThrow("API key cannot be blank");

    await expect(store.readPrivate()).resolves.toEqual({ ollamaCloudApiKey: "cloud-key", ollamaProvider: "cloud" });
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

  it("persists generation prefix options and the selected option across a new store instance", async () => {
    const store = new ConnectionsStore(tempDir);
    const generationPrefixOptions = "Рекламный;commercial campaign\nКаталог;clean product catalog";

    await store.save({
      generationPrefixOptions,
      generationPrefixSelection: "Каталог"
    });

    const reloadedStore = new ConnectionsStore(tempDir);
    await expect(reloadedStore.readPublic()).resolves.toMatchObject({
      generationPrefixOptions,
      generationPrefixSelection: "Каталог"
    });
  });

  it("drops legacy RunningHub workflow JSON and file name during the next save", async () => {
    const store = new ConnectionsStore(tempDir);
    await store.save({ runningHubWorkflowId: "workflow-1" });
    const filePath = join(tempDir, "connections.local.json");
    await writeFile(filePath, JSON.stringify({
      ...(await store.readPrivate()),
      runningHubWorkflowFileName: "legacy.json",
      runningHubWorkflowJson: "{}"
    }), "utf8");

    await store.save({ runningHubPromptNodeId: "6" });

    await expect(store.readPrivate()).resolves.toEqual({
      runningHubWorkflowId: "workflow-1",
      runningHubPromptNodeId: "6"
    });
  });

  it("preserves an explicitly cleared prompt instruction instead of replacing it with the default", async () => {
    const store = new ConnectionsStore(tempDir);

    await store.save({ ollamaPromptInstruction: "" });

    await expect(store.readPrivate()).resolves.toEqual({ ollamaPromptInstruction: "" });
    await expect(store.readPublic()).resolves.toMatchObject({ ollamaPromptInstruction: "" });
  });
});
