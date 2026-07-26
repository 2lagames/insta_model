# Generation Job Input Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RunningHub prompt bindings workflow-accurate, show the immutable generation recipe in Queue, number Reels, and report the true generation/download phases.

**Architecture:** Extend the persisted job input with independent image/video prompt records while retaining the legacy `prompt` field for existing queue snapshots. Build all visual and prompt sources once in `createRunningHubGenerationJobs`, execute RunningHub from that frozen input, and derive the Queue recipe through a pure presentation helper. Keep queue schema version 1 because the new fields are optional.

**Tech Stack:** TypeScript, React 19, Express 5, Vitest, Vite, local JSON persistence.

## Global Constraints

- The selected RunningHub workflow bindings are the source of truth.
- Studio ID 2 uses an image prompt and requires Studio ID 1 or 4.
- Studio ID 5 uses a video prompt and requires Studio ID 3.
- New jobs store separate image and video prompts; persisted legacy `prompt` jobs remain executable.
- Queue displays only frozen job inputs and never rereads editable Studio prompt state.
- IMAGE and REEL labels use independent current-session counters.
- Provider polling remains `running`; `downloading` starts only when result URLs are ready.
- No new automatic video-prompt generation, Queue prompt editing, drag-and-drop ordering, or storage migration.

---

### Task 1: Workflow-accurate prompt inputs

**Files:**
- Modify: `src/lib/runningHubJobs.ts`
- Modify: `src/lib/runningHubJobs.test.ts`

**Interfaces:**
- Produces: `RunningHubTextPromptInput`
- Produces: optional `imagePrompt` and `videoPrompt` fields on `RunningHubGenerationJobInput`
- Consumes: workflow `bindings`, selected `PromptMediaInput[]`, and `promptsByMediaId`

- [ ] **Step 1: Write failing prompt-source tests**

Add fixtures labeled `IMAGE 1`, `IMAGE 2`, and `REEL 1`. Add tests asserting:

```ts
expect(createRunningHubGenerationJobs({
  bindings: [
    { nodeId: "18", fieldName: "video", studioId: "3" },
    { nodeId: "44", fieldName: "image", studioId: "4" },
    { nodeId: "6", fieldName: "image_prompt", studioId: "2" },
    { nodeId: "7", fieldName: "video_prompt", studioId: "5" }
  ],
  selectedMedia: [sourceVideo, generatedImage],
  promptsByMediaId: new Map([
    [sourceVideo.id, "Video movement"],
    [generatedImage.id, "Image appearance"]
  ])
})).toEqual([{
  media: sourceVideo,
  generatedImage,
  imagePrompt: {
    mediaId: generatedImage.id,
    mediaLabel: generatedImage.label,
    text: "Image appearance"
  },
  videoPrompt: {
    mediaId: sourceVideo.id,
    mediaLabel: sourceVideo.label,
    text: "Video movement"
  }
}]);
```

Also assert that Studio ID 2 without ID 1/4 and Studio ID 5 without ID 3 produce workflow-configuration errors.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- src/lib/runningHubJobs.test.ts
```

Expected: failures because `imagePrompt` and `videoPrompt` do not exist and prompt binding dependencies are not validated.

- [ ] **Step 3: Implement explicit prompt selection**

Add:

```ts
export type RunningHubTextPromptInput = {
  mediaId: string;
  mediaLabel: string;
  text: string;
};
```

Extend `RunningHubGenerationJobInput` with `imagePrompt?`, `videoPrompt?`, and the existing `prompt?` legacy property.

In `createRunningHubGenerationJobs`:

- validate prompt-binding dependencies;
- select the image prompt source as generated image, then separate source image, then principal image media;
- select the video prompt source from principal video media;
- read and trim each source’s own prompt;
- create independent stored prompt records;
- retain current visual job pairing and validation behavior.

Update `prepareRunningHubGenerationJobs` to detect missing prompt text from the explicit prompt-source media IDs before its existing automatic prompt preparation.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/lib/runningHubJobs.test.ts
```

Expected: all RunningHub job-builder tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runningHubJobs.ts src/lib/runningHubJobs.test.ts
git commit -m "fix: bind prompts to workflow media types"
```

### Task 2: Independent RunningHub prompt fields and accurate phases

**Files:**
- Modify: `server/runningHub.ts`
- Modify: `server/runningHub.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `imagePrompt?: string`, `videoPrompt?: string`, and legacy `prompt?: string` on `RunningHubPromptJob`
- Produces: Studio ID 2/5 field values with independent text
- Produces: phase sequence ending `running`, then `downloading`

- [ ] **Step 1: Write failing payload and phase tests**

Add a generation test with both prompt bindings and assert the create payload contains:

```ts
[
  { nodeId: "6", fieldName: "image_prompt", fieldValue: "Image appearance" },
  { nodeId: "7", fieldName: "video_prompt", fieldValue: "Video movement" }
]
```

Record `onPhase` events and assert:

```ts
expect(phases).toEqual([
  "uploading",
  "submitting",
  "running",
  "downloading"
]);
expect(queryWasCompletedBeforeDownloading).toBe(true);
```

Add a legacy job test proving `prompt` supplies whichever configured prompt binding is present.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- server/runningHub.test.ts
```

Expected: independent prompt values are absent and `downloading` occurs before provider polling.

- [ ] **Step 3: Implement the server mapping**

Extend `RunningHubPromptJob`:

```ts
imagePrompt?: string;
videoPrompt?: string;
prompt?: string;
```

In `resolveStudioFieldValues`, resolve:

```ts
const prompt = binding.studioId === "2"
  ? options.job.imagePrompt ?? options.job.prompt
  : options.job.videoPrompt ?? options.job.prompt;
```

Move `await options.onPhase?.("downloading")` to immediately after `waitForTaskResult` returns and immediately before output download.

In `executeQueuedGeneration` and legacy synchronous generation routes, map stored prompt records into the new executor fields without rereading Studio state.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- server/runningHub.test.ts server/generationWorker.test.ts
```

Expected: all tests pass and phase order is accurate.

- [ ] **Step 5: Commit**

```bash
git add server/runningHub.ts server/runningHub.test.ts server/index.ts
git commit -m "fix: resolve RunningHub prompts by Studio ID"
```

### Task 3: Independent REEL numbering and queue recipe model

**Files:**
- Modify: `src/lib/mediaMaterials.ts`
- Modify: `src/lib/mediaMaterials.test.ts`
- Modify: `src/lib/generationQueueView.ts`
- Modify: `src/lib/generationQueueView.test.ts`

**Interfaces:**
- Produces: `IMAGE N` and `REEL N` material labels
- Produces: `createGenerationJobRecipe(job)` returning ordered visual and prompt chips plus result label

- [ ] **Step 1: Write failing numbering and recipe tests**

Change the existing session-label expectation to:

```ts
["IMAGE 1", "IMAGE 2", "IMAGE 3", "REEL 1"]
```

Add multiple video assets and assert `REEL 1`, `REEL 2`.

Add a recipe test:

```ts
expect(createGenerationJobRecipe(job)).toEqual({
  visualInputs: [
    { id: "reel-1", label: "REEL 1", previewPath: "/input/frame.jpg" },
    { id: "image-2", label: "IMAGE 2", previewPath: "/output/image.png" }
  ],
  promptInputs: [
    { kind: "image", label: "Промт: IMAGE 2" },
    { kind: "video", label: "Промт: REEL 1" }
  ],
  resultLabel: "Видео"
});
```

Add a duplicate-media test where `media` and `generatedImage` have the same ID and only one visual chip is returned.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/lib/mediaMaterials.test.ts src/lib/generationQueueView.test.ts
```

Expected: Reel remains unnumbered and the recipe helper is missing.

- [ ] **Step 3: Implement numbering and pure recipe derivation**

In `createSessionMediaMaterials`, maintain `imageNumber` and `videoNumber` counters and return `REEL ${videoNumber}` for video materials.

Add recipe types and `createGenerationJobRecipe(job)` to `generationQueueView.ts`. Build visual inputs from `media`, `sourceImage`, and `generatedImage`, deduplicate by media ID, and use each input’s `imagePath` as its preview. Build prompt chips from explicit prompt records, falling back to the legacy principal media only when `job.input.job.prompt` exists.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/lib/mediaMaterials.test.ts src/lib/generationQueueView.test.ts
```

Expected: all numbering and recipe tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mediaMaterials.ts src/lib/mediaMaterials.test.ts src/lib/generationQueueView.ts src/lib/generationQueueView.test.ts
git commit -m "feat: describe generation job inputs"
```

### Task 4: Render the generation recipe in Queue

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/App.layout.test.ts`

**Interfaces:**
- Consumes: `createGenerationJobRecipe(job)`
- Produces: responsive media thumbnails, prompt chips, separators, and result label inside each Queue row

- [ ] **Step 1: Add a failing Queue rendering regression**

Add assertions covering the consumer contract: `GenerationQueuePage` calls `createGenerationJobRecipe`, renders `.queue-recipe`, `.queue-recipe-media`, `.queue-recipe-prompt`, and uses each recipe preview path and label. Keep the behavioral recipe details in the pure helper tests from Task 3.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```bash
npm test -- src/App.layout.test.ts
```

Expected: failure because Queue does not render recipe elements.

- [ ] **Step 3: Implement the responsive recipe row**

Replace the single `queue-media-label` line with:

- compact visual chips containing 34–40 px square thumbnails and labels;
- `+` separators between inputs;
- prompt chips labeled `Промт: <media>`;
- a `→ Изображение` or `→ Видео` result marker.

Keep status, progress, task ID, error, reorder controls, cancel/retry/open actions, and primary job preview unchanged.

Add CSS so recipes wrap on narrow rows, thumbnails use `object-fit: cover`, and no chip can force horizontal page overflow.

- [ ] **Step 4: Run focused tests and build**

Run:

```bash
npm test -- src/App.layout.test.ts src/lib/generationQueueView.test.ts
npm run build
```

Expected: tests and TypeScript/Vite build pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css src/App.layout.test.ts
git commit -m "feat: show generation recipe in queue"
```

### Task 5: Integrated verification

**Files:**
- Verify: all modified files

**Interfaces:**
- Consumes: the complete implementation
- Produces: evidence that persisted queue behavior and UI remain compatible

- [ ] **Step 1: Run the full repository check**

Run:

```bash
npm run check
```

Expected: secret scan passes, all Vitest files pass, and production build succeeds.

- [ ] **Step 2: Restart the API process**

The project’s API command does not watch source files. Restart `npm run dev` so the active server loads the new RunningHub mapping and phase order.

- [ ] **Step 3: Verify the live UI**

At a wide viewport, confirm:

- Queue remains aligned left.
- Generated Media cards remain grouped at 8 px.
- a new video job shows numbered `REEL` and `IMAGE` inputs with thumbnails;
- prompt chips match Studio ID 2/5 sources;
- provider polling shows `Генерация`;
- only actual output transfer shows `Скачивание`;
- no browser console errors or horizontal overflow.

- [ ] **Step 4: Verify persistence and legacy compatibility**

Run focused tests again:

```bash
npm test -- server/generationQueueStore.test.ts server/generationWorker.test.ts server/runningHub.test.ts src/lib/runningHubJobs.test.ts
```

Expected: queue persistence/recovery, new prompt mapping, legacy fallback, and worker phases all pass.

- [ ] **Step 5: Record final status**

Confirm a clean worktree and list the implementation commits. Do not merge or push without an explicit user request.
