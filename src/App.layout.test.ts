import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("studio preview layout", () => {
  it("keeps vertical media and details side by side", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain('className="preview-main"');
    expect(appSource).toContain('className="preview-details"');
    expect(appSource).toContain('className="log-panel');
    expect(appSource).toContain("Media");
    expect(appSource.indexOf('className="generation-panel"')).toBeGreaterThan(appSource.indexOf('className="preview-side"'));
    expect(appSource.indexOf('className={`log-panel')).toBeGreaterThan(appSource.indexOf('className="bottom-gallery"'));
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
    expect(appSource).toContain("Using previously downloaded media.");
    expect(appSource.indexOf("Generate prompt")).toBeLessThan(appSource.indexOf("Image generation"));
    expect(appSource).toContain("EventSource");
    expect(appSource).toContain("activityEntries");
    expect(appSource).toContain("logFeedRef");
    expect(appSource).toContain("scrollTop = logFeedRef.current.scrollHeight");
    expect(appSource).not.toContain("const prompt = await generateImagePrompts");
    expect(appSource).not.toContain('recordStatus({ tone: "ready", message: prompt })');
    expect(appSource).toContain("Image generation");
    expect(cssSource).toContain("aspect-ratio: 9 / 16");
    expect(cssSource).toContain(".gallery-select");
    expect(cssSource).toContain("height: clamp(560px, 68vh, 780px)");
  });
});
