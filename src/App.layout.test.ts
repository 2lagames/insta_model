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
    expect(appSource).toContain('<MediaSelector');
    expect(appSource).toContain('<PromptEditors');
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
    expect(appSource).toContain("Вставить ключ");
    expect(appSource).toContain("Ollama Cloud");
    expect(appSource).toContain("Локальная Ollama");
    expect(appSource).toContain("Image node ID");
    expect(appSource).toContain('aria-label="Отменить изменение промта"');
    expect(appSource).toContain("generateImages(imageJobs)");
    expect(appSource).not.toContain("workflow-file-control");
    expect(cssSource).toContain("aspect-ratio: 9 / 16");
    expect(cssSource).toContain(".gallery-select");
    expect(cssSource).toContain(".media-selector");
    expect(cssSource).toContain("grid-template-columns: auto minmax(110px, 150px) minmax(200px, 0.75fr) minmax(180px, 0.5fr)");
    expect(cssSource).toContain(".prompt-editors textarea");
    expect(cssSource).toContain("height: clamp(560px, 68vh, 780px)");
  });

  it("aligns column content at the top without stretching the studio panels", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const cssSource = readFileSync("src/App.css", "utf8");

    expect(appSource).toContain('className="info-content"');
    expect(cssSource).toContain(".preview-details {\n  min-width: 0;\n  display: grid;\n  grid-template-rows: auto auto;\n  gap: 0;");
    expect(cssSource).toContain(".info-content {\n  display: grid;\n  gap: 8px;");
    expect(cssSource).toContain("grid-auto-rows: 42px");
    expect(cssSource).not.toContain("--studio-stage-height");
    expect(cssSource).not.toContain("overflow-y: auto");
  });

  it("offers explicit prompt saving and describes a local image source", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain("saveSessionPrompts");
    expect(appSource).toContain("onSave");
    expect(appSource).toContain(">Сохранить</button>");
    expect(appSource).toContain("Локальное изображение — ссылка Instagram отсутствует");
    expect(appSource).toContain("urlNotice");
  });
});
