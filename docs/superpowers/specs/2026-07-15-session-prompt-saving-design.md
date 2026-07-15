# Session Prompt Saving Design

## Goal

Keep the latest intentionally saved Studio prompt available after an application restart, while avoiding implicit saves on every keystroke.

## User flow

1. After Ollama generates a prompt, Studio places the resulting text in that media item's editor.
2. Each editor has a `Сохранить` button. It writes that editor's current text to the current local session.
3. `Image generation` first saves every prompt that will be sent to RunningHub, then starts generation. The saved text is the exact text sent to RunningHub.
4. On startup, Studio recreates prompt editors from the prompt texts stored in the current session.
5. `Сброс` clears selected media and all session prompt texts.
6. Uploading a local image starts a new session with an empty prompt-text map, so no prompt from a previous Instagram import remains visible.
7. A locally uploaded item displays `Локальное изображение — ссылка Instagram отсутствует` in the source field instead of a link.

## Architecture

- `CurrentMediaSession.promptTexts` remains the durable source for saved editor text.
- A new local API updates prompt text for one or more media ids in the current session. It returns the updated session.
- The client calls that endpoint from the editor's save button and before image generation.
- The client does not call the endpoint while the user types. Unsaved text remains visible in the open editor, but only an explicit save or image generation makes it durable.
- Session reset and local-upload endpoints write a session with `promptTexts: {}`.

## Error handling

- If saving fails, the editor remains unchanged and Studio shows an error status.
- Image generation does not begin if its pre-generation prompt save fails.
- Local uploads keep the existing upload error handling; a successful upload always returns an empty prompt-text map.

## Validation

- Unit tests cover session prompt update and clearing behavior.
- Client API tests cover the new save request.
- The layout test checks that the save action and local-source message are present.
- `npm run check` must pass.
