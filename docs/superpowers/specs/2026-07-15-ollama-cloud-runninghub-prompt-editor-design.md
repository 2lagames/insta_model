# Ollama Cloud, RunningHub, and Prompt Editor Design

## Goal

Add configurable Ollama Cloud and local Ollama prompt generation, enable image-to-image RunningHub workflows through `LoadImage`, and make generated prompts editable and reusable in Studio.

## Scope

The application will preserve existing Instagram import and session behavior. The change covers the Connections page, prompt generation, RunningHub image generation, prompt editing, and Studio layout.

## Connections

### API keys

ScrapeCreators, Ollama Cloud, and RunningHub API keys remain private in `data/connections.local.json` and remain masked in the Connections page status text.

Each integration card shows either `Ключ не сохранён.` or `Ключ сохранён локально: [masked preview]`, followed by two controls:

- `Вставить ключ` opens a modal dialog with a plain text field. It is prefilled with the current key when one exists, so the user can replace, amend, or delete it deliberately. Saving the dialog stores that integration's key.
- `Очистить` deletes that integration's saved key and updates the masked status.

No API key field is rendered directly in the card, so focusing a control cannot silently clear a key. The key is exposed to the local frontend only inside the edit modal, which is necessary to support amendment after restart; the stored file stays ignored by Git.

### Ollama provider

The new `Ollama` card sits between ScrapeCreators and RunningHub. It has a persisted Cloud/Local toggle.

- Cloud uses `https://ollama.com/api`, sends `Authorization: Bearer [saved key]`, and obtains models from `GET /api/tags`.
- Local uses the configured local host (default `http://127.0.0.1:11434`) and obtains models from `GET /api/tags` without a key.
- The app loads local models during startup. Cloud model loading is skipped until a Cloud key exists. Both model selectors have a `↻` manual refresh control.
- Each provider has its own selected model. Switching providers preserves the saved selection for the other provider.
- The card has one shared, multiline `Промт для генерации` field. Its initial persisted value is the current image-to-prompt instruction text previously embedded in server code. The active provider receives the user's latest text verbatim together with the attached source image.

The model lists are runtime data; the selected model, provider selection, and common prompt instruction are persisted.

### RunningHub

The workflow JSON file and all related storage and validation are removed from the UI and execution path. RunningHub uses the existing advanced task API with the stored Workflow ID and node overrides.

The card contains:

- API key, edited only through the masked-key dialog;
- Workflow ID;
- Prompt node ID and Prompt field;
- Image node ID and Image field.

The non-secret settings are ordinary editable inputs and save with the RunningHub settings action.

## Generation flow

### Prompt generation

`Generate prompt` collects the selected Studio media and sends it to the local server. The server reads the active Ollama mode, selected model, key if required, and shared instruction from the connections store. It sends each source image to the selected Ollama endpoint and returns a distinct generated prompt associated with that source media ID.

The response is treated as prompt text rather than requiring the previous Ideogram JSON schema. The initial shared prompt preserves the existing structured-output behavior for users who want it, but a user can replace it with instructions for plain text prompt output.

### Editable prompt documents

Studio keeps a prompt document for every media ID returned by prompt generation. A document contains the original generated value, the current value, a history of edits, and a history cursor.

For one selected item, the editor shows one document. For multiple selected items, it shows vertically stacked cards with a clear separator and a media label. Each card has a normal editable textarea of at least 20 visible lines and icon buttons with accessible labels:

- `↶` undo one prompt edit;
- `↷` redo one prompt edit;
- `↺` reset the current value to the original generated prompt and reset the history position.

Each document's history is independent. The current text is kept in the frontend during the Studio session; changing the selection does not mix documents.

### Image generation

`Image generation` does not generate a prompt. It requires a current prompt document for every selected media item and sends the source media plus the latest editor text in matching pairs. If a selected item has no prompt, it returns a clear instruction to generate a prompt first.

For every pair, the server:

1. Reads the selected source file from `input/`.
2. Uploads it to RunningHub through its resource upload API.
3. Receives the uploaded `fileName`.
4. Creates a RunningHub task with a `nodeInfoList` containing the image override for the configured `LoadImage` node and the text override for the configured prompt node.
5. Polls, downloads outputs, and attaches them to the current session as before.

This produces one task per selected media item, preserving the `media → prompt → output` relationship.

## Layout

On desktop, Studio is rearranged as four neighbouring columns: source image, vertical Media selector, narrower import information, and Generation workspace. The Media selector is vertically scrollable and matches the image preview height. The import details and generation controls receive less width than today. On narrow screens the layout collapses to a single column while retaining all controls.

The prompt editor sits in the Studio workspace below the main preview area so it can display at least 20 lines per prompt without shrinking the source image or Media selector.

## Errors and validation

- Cloud refresh and Cloud prompt generation clearly report a missing Cloud API key.
- Local refresh and local prompt generation clearly report that the local Ollama endpoint cannot be reached.
- Empty model selection, shared prompt, RunningHub Workflow ID, text-node fields, and image-node fields block their applicable action with an actionable message.
- RunningHub upload errors include the source media label and stop before task creation for that media.
- A RunningHub task is only created after a source image upload succeeds.
- Existing media selection, import reset, activity events, session mapping, output polling, and download behavior remain intact.

## Testing

Server unit tests cover connection persistence and clearing, Cloud/Local model-list requests, provider-specific authorization headers, raw prompt generation, RunningHub upload followed by task creation with both node overrides, and one-to-one prompt/media pairing.

Client/API tests cover request payloads for prompt-only and image-generation actions. UI layout tests cover the relevant labels and controls, including masked API-key status, key-edit modal controls, provider toggle, model refresh controls, prompt editor actions, and the vertical Media container.

## Sources

Ollama Cloud uses its direct API host and bearer authentication, and exposes its model list through `/api/tags`, as described in the [Ollama Cloud documentation](https://docs.ollama.com/cloud) and [authentication reference](https://docs.ollama.com/api/authentication). RunningHub accepts resource uploads and uses the returned filename as the configured `LoadImage` node field value before task creation, as described in its [nodeInfoList guide](https://www.runninghub.ai/runninghub-api-doc-en/doc-6333421) and [resource upload reference](https://www.runninghub.ai/runninghub-api-doc-en/api-425761099).
