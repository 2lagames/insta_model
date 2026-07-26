# Generation Job Inputs and Queue Visibility

## Goal

Make every generation job deterministic and understandable:

- RunningHub receives visual inputs and text prompts strictly according to the workflow bindings configured on the Settings tab.
- Queue shows which media and prompts are frozen into each job.
- Image and video media have stable session labels.
- Queue phases describe what the worker is actually doing.

## Current Problems

The current job model stores one optional `prompt` string. RunningHub uses that same value for both Studio ID 2 and Studio ID 5. This loses the prompt source and cannot represent a workflow that uses separate image and video prompts.

The worker also switches a job to `downloading` before RunningHub has completed generation. The UI therefore shows “Скачивание” throughout provider polling.

Queue currently shows only the principal media item, so a combined job such as a source Reel plus a generated image is not visible as a composition.

Session image labels are numbered, but Reel labels are not.

## Approved Product Behavior

### Workflow-driven inputs

The selected RunningHub workflow remains the source of truth:

- Studio ID 1 uses the source image.
- Studio ID 2 uses the prompt belonging to the image used by the workflow.
- Studio ID 3 uses the source video.
- Studio ID 4 uses the generated image.
- Studio ID 5 uses the prompt belonging to the video used by the workflow.

Studio ID 2 and Studio ID 5 are independent. A workflow containing both bindings can send two different prompt strings.

### Prompt source selection

Each stored prompt input includes the prompt text and the source media identity and label.

For Studio ID 2, the image source is selected deterministically:

1. the generated image used by Studio ID 4;
2. otherwise the separate source image used by Studio ID 1;
3. otherwise the principal job media when it is an image.

For Studio ID 5, the source is the principal job media that supplies the Studio ID 3 video.

Studio ID 2 requires Studio ID 1 or Studio ID 4 in the same workflow, and Studio ID 5 requires Studio ID 3. An invalid prompt binding is reported as a workflow configuration error instead of guessing a source.

If a required prompt is missing for the selected source, job preparation fails before enqueueing and names the media label in the error.

Automatic prompt generation keeps its existing scope. This change does not add new automatic video-prompt behavior.

### Persistent job model

New jobs store explicit prompt inputs:

```ts
type RunningHubTextPromptInput = {
  mediaId: string;
  mediaLabel: string;
  text: string;
};

type RunningHubGenerationJobInput = {
  media: PromptMediaInput;
  sourceImage?: PromptMediaInput;
  generatedImage?: PromptMediaInput;
  imagePrompt?: RunningHubTextPromptInput;
  videoPrompt?: RunningHubTextPromptInput;
  prompt?: string; // legacy persisted jobs only
};
```

The queue snapshot continues using schema version 1 because all new properties are optional and older snapshots remain structurally valid.

For an older persisted job containing only `prompt`, the worker uses the legacy value for whichever prompt bindings are configured and identifies the principal media as the fallback source in Queue. New jobs never rely on the legacy field.

### RunningHub payload

RunningHub field resolution maps values independently:

- Studio ID 2 receives `imagePrompt.text`;
- Studio ID 5 receives `videoPrompt.text`.

The worker must not collapse these values into one `prompt` argument.

## Queue Card Design

Each row retains the output kind, workflow display ID, status, task ID, attempt, actions, and error.

Below the title, the row shows a compact generation recipe:

`[thumbnail] REEL 1 + [thumbnail] IMAGE 2 + Промт: IMAGE 2 + Промт: REEL 1 → Видео`

Rules:

- Each visual input is a compact chip containing a thumbnail and label.
- A Reel chip uses its stored first frame as the thumbnail.
- Visual inputs are ordered as principal job media, separate source image, then generated image.
- Duplicate media identities are shown once even if one media fills multiple workflow bindings.
- Prompt chips show only `Промт: <media label>`; the long text remains editable in Studio.
- Only inputs actually stored in the job are shown.
- The result label is `Изображение` or `Видео`.
- Existing action buttons and reorder controls remain at the right side of the row.
- On narrower layouts the recipe wraps within the row instead of widening the page.

## Media Numbering

`createSessionMediaMaterials` maintains two independent counters in current-session order:

- image materials: `IMAGE 1`, `IMAGE 2`, and so on;
- video materials: `REEL 1`, `REEL 2`, and so on.

A video asset still produces two independent selectable materials when available: its first frame participates in IMAGE numbering, and its video participates in REEL numbering.

## Accurate Status Phases

The worker phase order is:

1. `uploading` while required media inputs are uploaded;
2. `submitting` while the RunningHub task is created;
3. `running` during provider polling and while waiting for result URLs;
4. `downloading` only after result URLs are available and local file download begins;
5. `succeeded` after the output item and current session are persisted.

The existing canceling, failure, and restart-recovery behavior remains unchanged.

## Data Flow

1. Studio converts selected session materials into `PromptMediaInput` values with numbered labels.
2. `createRunningHubGenerationJobs` reads workflow bindings and selects visual and prompt sources.
3. The complete immutable job input is written to the persistent queue.
4. Queue renders its recipe only from the stored job input.
5. The server worker resolves each Studio ID from that same stored input.
6. Status events update the actual worker phase.
7. Successful output is persisted and appears immediately in Generated Media.

Editing prompts or changing workflow settings after enqueueing does not alter an existing job.

## Error Handling

- Missing required image or video input prevents enqueueing.
- Missing Studio ID 2 or Studio ID 5 prompt identifies the expected media label.
- A persisted legacy job remains executable through the legacy prompt fallback.
- Queue recipe rendering tolerates incomplete legacy metadata and shows the inputs that can be identified.
- Failed prompt selection does not create a partial queue job.

## Testing

Automated coverage must include:

- Studio ID 2 selects the prompt of the actual image input.
- Studio ID 5 selects the prompt of the actual video input.
- A workflow with both IDs stores and sends two different prompt strings.
- A generated-image-plus-video job exposes both visual inputs and the correct prompt labels.
- Legacy `prompt` jobs still resolve configured prompt bindings.
- provider polling remains `running`, and `downloading` begins only after result URLs exist;
- IMAGE and REEL counters are independent;
- queue recipe deduplicates repeated media inputs and preserves its display order;
- existing queue persistence, recovery, cancellation, retry, reorder, and Generated Media tests remain green.

## Out of Scope

- Editing prompt text from Queue.
- Changing workflow bindings from Queue.
- Replacing the approved up/down queue reordering with drag-and-drop.
- Adding automatic video-prompt generation.
- Migrating queue persistence to a different storage engine.
