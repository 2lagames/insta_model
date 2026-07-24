import { describe, expect, it } from "vitest";
import {
  appendPromptDocument,
  createPromptTextRecord,
  createPromptDocuments,
  editPromptDocument,
  ensurePromptDocument,
  getCurrentPrompt,
  mergePromptDocuments,
  redoPromptDocument,
  resetPromptDocument,
  setPromptDocumentPrefix,
  undoPromptDocument,
} from "./promptDocuments";

describe("prompt documents", () => {
  it("creates one document per media prompt with its original value selected", () => {
    const documents = createPromptDocuments([
      { mediaId: "media-1", label: "Image", prompt: "original" },
      { mediaId: "media-2", label: "Video", prompt: "another original" },
    ]);

    expect(documents).toEqual([
      {
        mediaId: "media-1",
        label: "Image",
        original: "original",
        history: ["original"],
        managedPrefixes: [""],
        historyIndex: 0,
      },
      {
        mediaId: "media-2",
        label: "Video",
        original: "another original",
        history: ["another original"],
        managedPrefixes: [""],
        historyIndex: 0,
      },
    ]);
  });

  it("serializes the current value of every prompt for local persistence", () => {
    const initial = createPromptDocuments([
      { mediaId: "media-1", label: "Image", prompt: "original" },
      { mediaId: "media-2", label: "Video", prompt: "second" },
    ]);
    const edited = editPromptDocument(initial, "media-1", "prefix, revised");

    expect(createPromptTextRecord(edited)).toEqual({
      "media-1": "prefix, revised",
      "media-2": "second",
    });
  });

  it("undoes an edit back to the original prompt", () => {
    const initial = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "original" }]);
    const edited = editPromptDocument(initial, "media-1", "revised");

    expect(getCurrentPrompt(undoPromptDocument(edited, "media-1")[0])).toBe("original");
  });

  it("resets an edited document to its original prompt", () => {
    const initial = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "original" }]);
    const edited = editPromptDocument(initial, "media-1", "revised");

    expect(getCurrentPrompt(resetPromptDocument(edited, "media-1")[0])).toBe("original");
    expect(resetPromptDocument(edited, "media-1")[0]).toMatchObject({
      history: ["original"],
      historyIndex: 0,
    });
  });

  it("does not add a history entry when the prompt is unchanged", () => {
    const initial = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "original" }]);

    expect(editPromptDocument(initial, "media-1", "original")).toEqual(initial);
  });

  it("drops redo history after editing from an undone prompt", () => {
    const initial = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "original" }]);
    const twiceEdited = editPromptDocument(editPromptDocument(initial, "media-1", "first"), "media-1", "second");
    const reedited = editPromptDocument(undoPromptDocument(twiceEdited, "media-1"), "media-1", "replacement");

    expect(reedited[0]).toMatchObject({ history: ["original", "first", "replacement"], historyIndex: 2 });
    expect(getCurrentPrompt(redoPromptDocument(reedited, "media-1")[0])).toBe("replacement");
  });

  it("keeps other media documents unchanged", () => {
    const initial = createPromptDocuments([
      { mediaId: "media-1", label: "Image", prompt: "original" },
      { mediaId: "media-2", label: "Video", prompt: "other" },
    ]);

    const edited = editPromptDocument(initial, "media-1", "revised");

    expect(getCurrentPrompt(edited[1])).toBe("other");
    expect(edited[1]).toBe(initial[1]);
  });

  it("replaces generated documents by media ID without discarding edits for other media", () => {
    const initial = createPromptDocuments([
      { mediaId: "media-1", label: "Image", prompt: "first original" },
      { mediaId: "media-2", label: "Video", prompt: "second original" },
    ]);
    const edited = editPromptDocument(initial, "media-1", "first revised");

    const merged = mergePromptDocuments(edited, [
      { mediaId: "media-2", label: "Video", prompt: "second regenerated" },
      { mediaId: "media-3", label: "Image", prompt: "third generated" },
    ]);

    expect(merged).toHaveLength(3);
    expect(getCurrentPrompt(merged.find((document) => document.mediaId === "media-1")!)).toBe("first revised");
    expect(getCurrentPrompt(merged.find((document) => document.mediaId === "media-2")!)).toBe("second regenerated");
    expect(getCurrentPrompt(merged.find((document) => document.mediaId === "media-3")!)).toBe("third generated");
  });

  it("creates an empty prompt for selected media without replacing an existing prompt", () => {
    const empty = ensurePromptDocument([], { mediaId: "media-1", label: "Image", prompt: "" });
    const existing = ensurePromptDocument(empty, { mediaId: "media-1", label: "Changed label", prompt: "replacement" });

    expect(getCurrentPrompt(empty[0])).toBe("");
    expect(existing).toBe(empty);
    expect(getCurrentPrompt(existing[0])).toBe("");
  });

  it("applies, replaces, and removes only the managed prompt prefix", () => {
    const manual = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "Мой текст" }]);
    const withKristina = setPromptDocumentPrefix(manual, "", "Текст Кристины");
    const withOther = setPromptDocumentPrefix(withKristina, "Текст Кристины", "Другой текст");
    const withoutPrefix = setPromptDocumentPrefix(withOther, "Другой текст", "");

    expect(getCurrentPrompt(withKristina[0])).toBe("Текст Кристины\nМой текст");
    expect(getCurrentPrompt(withOther[0])).toBe("Другой текст\nМой текст");
    expect(getCurrentPrompt(withoutPrefix[0])).toBe("Мой текст");
  });

  it("removes the prefix restored by undo even when the dropdown previously held another prefix", () => {
    const manual = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "Мой текст" }]);
    const withKristina = setPromptDocumentPrefix(manual, "", "Текст Кристины");
    const withOther = setPromptDocumentPrefix(withKristina, "Текст Кристины", "Другой текст");
    const undone = undoPromptDocument(withOther, "media-1");
    const withoutPrefix = setPromptDocumentPrefix(undone, "Другой текст", "");

    expect(getCurrentPrompt(undone[0])).toBe("Текст Кристины\nМой текст");
    expect(getCurrentPrompt(withoutPrefix[0])).toBe("Мой текст");
  });

  it("appends every generated prompt on a new line without replacing earlier text", () => {
    const initial = createPromptDocuments([{
      mediaId: "media-1",
      label: "Image",
      prompt: "Текст Кристины\nМой текст",
    }]);
    const once = appendPromptDocument(initial, { mediaId: "media-1", label: "Image", prompt: "Первая генерация" });
    const twice = appendPromptDocument(once, { mediaId: "media-1", label: "Image", prompt: "Вторая генерация" });

    expect(getCurrentPrompt(twice[0])).toBe(
      "Текст Кристины\nМой текст\nПервая генерация\nВторая генерация",
    );
  });

  it("does not add leading, trailing, or blank lines while composing prompts", () => {
    const empty = createPromptDocuments([{ mediaId: "media-1", label: "Image", prompt: "" }]);
    const withPrefix = setPromptDocumentPrefix(empty, "", "Текст Кристины\n");
    const withGenerated = appendPromptDocument(withPrefix, {
      mediaId: "media-1",
      label: "Image",
      prompt: "\nСгенерированный текст\n",
    });

    expect(getCurrentPrompt(withPrefix[0])).toBe("Текст Кристины");
    expect(getCurrentPrompt(withGenerated[0])).toBe("Текст Кристины\nСгенерированный текст");
  });
});
