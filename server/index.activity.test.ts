import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("image prompt activity", () => {
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

    expect(source).toContain('app.get("/api/connections/keys/:keyName"');
    expect(source).toContain('app.put("/api/connections/keys/:keyName"');
    expect(source).toContain('app.delete("/api/connections/keys/:keyName"');
    expect(source).toContain("connectionsStore.saveKey");
    expect(source).toContain("connectionsStore.clearKey");
  });

  it("runs RunningHub only with submitted media and edited prompts", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const imageRouteStart = source.indexOf('app.post("/api/generation/images"');
    const imageRoute = source.slice(imageRouteStart, source.indexOf("const host", imageRouteStart));

    expect(imageRoute).toContain("parseRunningHubPromptJobs(request.body?.jobs)");
    expect(imageRoute).not.toContain("generateIdeogramPromptForMedia");
    expect(imageRoute).not.toContain("workflowJson");
    expect(imageRoute).toContain("imagePath: resolvePromptMediaImagePath(job.media.imagePath)");
  });
});
