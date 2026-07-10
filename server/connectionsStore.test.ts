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
      hasRunningHubApiKey: true,
      runningHubApiKeyPreview: "**********************7890",
      hasRunningHubWorkflow: true,
      runningHubWorkflowFileName: "ideogram-api.json",
      runningHubWorkflowId: "1904136902449209346",
      runningHubPromptNodeId: "6",
      runningHubPromptFieldName: "text"
    });
  });
});
