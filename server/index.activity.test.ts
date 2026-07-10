import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("image prompt activity", () => {
  it("publishes the generated Ideogram JSON prompt into the activity log", () => {
    const source = readFileSync("server/index.ts", "utf8");

    expect(source).toContain("Ideogram JSON prompt");
    expect(source).toContain("message: prompt");
    expect(source.indexOf("message: prompt")).toBeGreaterThan(source.indexOf("generateIdeogramPromptForMedia"));
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

  it("runs scene analysis from prompt generation instead of import", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const promptRouteStart = source.indexOf('app.post("/api/generation/image-prompts"');
    const imageRouteStart = source.indexOf('app.post("/api/generation/images"');
    const promptRoute = source.slice(promptRouteStart, imageRouteStart);

    expect(promptRoute.indexOf("ensureSceneBiblesForPromptMedia")).toBeGreaterThan(-1);
    expect(promptRoute.indexOf("ensureSceneBiblesForPromptMedia")).toBeLessThan(promptRoute.indexOf("generateIdeogramPromptForMedia"));
  });
});
