# Generation Control and Media Labels Design

## Goal

Make ongoing text and image generation stoppable immediately, cancel RunningHub work remotely, reveal prompts as each selected image completes, and make selection and image-to-prompt mapping unambiguous.

## Settings naming

Rename the `Подключения` navigation tab and its page heading to `Настройки`. The underlying connections API, persisted data, and component state remain unchanged.

## Unified generation controller

The server owns one active-generation controller shared by every generation type. It tracks the current operation's abort signal and every RunningHub task ID created during that operation.

The client exposes an always-enabled `Отмена` button at the bottom of `GENERATION WORKSPACE`. It is available regardless of whether a generation is currently running. When pressed during a generation, it immediately returns the interface to a non-running state and sends a cancellation request to the server without waiting for the original generation response.

The server cancellation route aborts the active local operation. For every RunningHub task ID already created, it concurrently requests `POST /task/openapi/cancel` with the stored API key and task ID. Failure to cancel an already-finished or unavailable remote task is recorded in the activity log but does not prevent local cancellation. The existing generation request exits with a recognizable cancellation error and does not save a partial generated import. Prompt generation passes the abort signal into its Ollama request; this stops the local wait and prevents any remaining selected media from starting. The controller is designed as a provider-neutral interface so video generation can register with it later.

## Incremental prompts

Prompt generation processes selected media in displayed order, one item at a time. Each successful prompt is saved locally and immediately merged into the editor state before the next item starts. A selected generation prefix is applied before insertion and persistence. Existing prompts are retained and are not regenerated. If cancelled or if a later item fails, already generated prompts remain visible and saved; the unstarted items have no prompt.

## Selection behavior

The Media action evaluates the current selection against all visible materials:

- If one or more materials are unselected, it selects every material and displays `Выбрать все`.
- If every material is selected, it clears the selection and displays `Снять выделение`.

## Media and prompt labels

Every image material in the current session receives a stable, one-based label in displayed order: `IMAGE 1`, `IMAGE 2`, and so on through the final image. The same label is used in the generated prompt document header, so each editor explicitly identifies its source image. The selected-media filter remains unchanged: only checked image materials appear in prompt editors. Video materials retain their own labels and are not included in image numbering.

## Error handling and tests

Cancellation is reported as a neutral ready status rather than an error. Genuine provider failures still use the existing error path. Tests cover controller cancellation and remote task cancellation, abort propagation, no partial image import, incremental prompt persistence, selection toggling and button text, and ordered image labels.
