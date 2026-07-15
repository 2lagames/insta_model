# Connections Layout and Local Image Upload Design

## Goal

Compact the Connections screen as specified and let Studio import a locally selected image into the same media and generation flow used for Instagram imports.

## Connections layout

- ScrapeCreators shows its heading, masked key status, then `Вставить ключ` and `Очистить` directly below the status.
- Ollama has the heading at the card top. Its left column contains the Cloud/Local toggle, masked Cloud-key status, key actions, then Cloud and Local model controls. Its right column contains the shared prompt-instruction textarea, sized to remain inside the card.
- RunningHub has a full-width Workflow ID control above a compact two-column grid. The left pair is Prompt node ID and Prompt field; the right pair is Image node ID and Image field. Inputs have a bounded width rather than stretching across the page.
- Narrow layouts collapse these controls to a single column.

## Local upload

Studio replaces the ScrapeCreators `Check` action with `Загрузить изображение` and a hidden file chooser accepting standard image MIME types. The client sends the selected file to a local API endpoint using multipart form data.

The server validates that a file is present and is an image, creates a ready `ImportItem` and one image asset, writes the original file under the ignored `input/` directory, saves the item through `ImportStore`, and starts it as the current media session. The response shape matches the existing Instagram import response.

The client treats that response exactly like an Instagram import: it selects the local image, adds it to Media, and queues it for prompt generation. No ScrapeCreators key, URL validation, or Instagram metadata is needed. Prompt generation and RunningHub generation continue to use the normal selected-media pipeline, so the uploaded image is read from `input/` and uploaded to RunningHub as before.

## Validation and tests

- Reject missing uploads and unsupported media types with clear errors.
- Verify the endpoint creates a local image item with a stable local source URL and an input image path.
- Verify the client posts `FormData` to the upload endpoint and incorporates the returned session/item.
- Verify layout tests assert the new buttons and compact layout classes.
