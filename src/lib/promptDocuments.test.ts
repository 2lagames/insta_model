import { describe, expect, it } from "vitest";
import {
  createPromptTextRecord,
  createPromptDocuments,
  editPromptDocument,
  getCurrentPrompt,
  mergePromptDocuments,
  redoPromptDocument,
  resetPromptDocument,
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
        historyIndex: 0,
      },
      {
        mediaId: "media-2",
        label: "Video",
        original: "another original",
        history: ["another original"],
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
});
