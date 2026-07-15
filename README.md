# Instagram Import Studio

Local web studio for turning Instagram posts, Reels, and local image files into reusable source material for a content-production workflow. It downloads photos, carousel items, video first frames, captions, and metadata through ScrapeCreators; generates editable image prompts with Ollama Cloud or a local Ollama instance; and sends the selected source image and final prompt to a RunningHub ComfyUI workflow running Krea 2.

It is designed for creators who need to revisit the same reference post without repeatedly downloading the same assets. Normal imports reuse healthy local media; use **Обновить заново** only when a fresh download is needed.

## Install

To give the app to another person, create a new empty folder and copy only the
installer for their operating system into it. Then double-click the file:

| System | File |
| --- | --- |
| Windows | `instal.bat` |
| macOS | `instal.command` |

The installer automatically installs Git and Node.js LTS, downloads the latest
published application release into that same folder, installs its dependencies,
and opens <http://localhost:5173>. On Windows it uses `winget`; on macOS it uses
Homebrew and macOS can ask for an administrator password. Keep the terminal
window open while using the application.

## Run

Double-click the launcher for your operating system:

| System | File |
| --- | --- |
| Windows | `start.bat` |
| macOS | `start.command` |

The launcher opens a terminal window, installs npm dependencies on the first run, then opens the project in the default browser at <http://localhost:5173>. Leave that terminal window open while working. Closing it stops the local server.

Both launchers show a clear message if Node.js/npm is missing. Install the current LTS version from <https://nodejs.org/>, then run the launcher again.

## Update

Double-click the updater for your operating system:

| System | File |
| --- | --- |
| Windows | `update.bat` |
| macOS | `update.command` |

The updater downloads the latest published release tag in the `vX.Y.Z` format,
installs the required npm dependencies, and starts the local studio. It stops
before replacing any tracked local changes. If Git needs manual attention or a
prerequisite is missing, the terminal stays open with the error message.

You can also update from a terminal:

```bash
./update.sh
```

## Connections

Open the `Подключения` tab and save API settings there:

- ScrapeCreators API key for Instagram imports.
- Ollama Cloud API key, Cloud/Local mode, model selection, and shared instruction for prompt generation.
- RunningHub API key and workflow ID for Krea 2 generation.
- Prompt node ID and prompt field name for replacing the workflow prompt.
- Image node ID and image field name for the workflow `LoadImage` node.

API keys are shown in the UI only as a masked preview. Use **Вставить ключ** to replace a key and **Очистить** to remove it. The replacement field is always empty: the saved raw key is never loaded into the browser. The workflow JSON is managed in RunningHub and is not uploaded to this application.

The key is stored locally in:

```text
data/connections.local.json
```

`data/`, `input/`, `output/`, and `*.local.json` are ignored by git. On macOS and Linux, `connections.local.json` is created and repaired with owner-only `0600` permissions. The local API does not publish this file or the session index; only an allowlisted ScrapeCreators metadata response can be opened through `/media/imports/...`.

Local persistence does not prevent the configured integrations from receiving data required to perform their work. ScrapeCreators, Ollama Cloud, and RunningHub receive their API keys when called; prompt instructions, selected images, workflow settings, and final prompts are sent only to the selected generation service, not to GitHub.

## Import Flow

1. Paste an Instagram post or Reels URL in `Студия` and press `Import`, or use **Загрузить изображение** to select a local image.
3. The local API calls ScrapeCreators `GET /v1/instagram/post` with `download_media=true`.
4. Photos, carousel items, videos, first-frame thumbnails, and caption text appear in the interface. A local image is used as the source without an Instagram link.
5. Downloaded or uploaded source media is stored under `input/`.

**Сброс** clears the current media session, preview, metadata, and prompt text, but keeps the Studio layout and persistent Generation workspace options. It does not delete files from `input/` or `output/`.

## Image Prompt Flow

The `Media` panel supports selecting one or more materials for later generation. The active preview and the selected generation queue are separate: click a card to preview it, use `Use` to include it in prompt generation.

Press `Generate prompt` to send the selected source image to the model currently selected in **Ollama Cloud** or **Локальная Ollama**. The shared instruction is edited on the `Подключения` page.

Each generated prompt is displayed in a large editable field. Typing, undo, redo, reset, and an applied Generation workspace prefix are saved to the local current session after a short pause. You can also press **Сохранить** explicitly. Saved prompt text persists when the page is reloaded within the current media session, and image generation saves the exact latest text before sending it to RunningHub.

The **Generation workspace** selector stores reusable prefix variants in the format `Название;Текст`, one variant per line. When a variant is selected, the final prompt is `Текст, Image`, where `Image` is the generated or edited Ollama prompt. With **Не выбрано**, the Ollama prompt is used unchanged. These variants are saved in application settings and are not changed by **Сброс**.

Press `Image generation` to upload each selected source image to RunningHub and create a task through `POST /task/openapi/create`. The app uses `nodeInfoList` to replace both the configured prompt node field and the configured `LoadImage` field. The configured workflow generates images with **Krea 2**. The task payload requests RunningHub Plus with `instanceType: "plus"`.

The uploaded ComfyUI workflow must include a `SaveImage` node connected to the final image. `PreviewImage` is useful inside ComfyUI, but it does not expose files through RunningHub `/task/openapi/outputs`, so the app cannot download generated images from preview-only workflows. Do not connect `SaveImage.images` to `PreviewImage`; connect it to the same final image source that feeds preview, for example `VAEDecode` or the final image pass-through node.

After a RunningHub task reaches `SUCCESS`, the app polls outputs up to 12 times by default. Override this with `RUNNINGHUB_OUTPUT_MAX_POLLS` if RunningHub needs more time to expose saved files.

Prompt generation returns ordinary editable text. The exact wording and detail level are controlled by the shared Ollama instruction, so the same application can work with different Ollama vision models.

The app saves every image returned by RunningHub for each selected Media item. If your workflow returns 1 image, the app saves 1; if it returns 4 images, the app saves all 4. The only invalid result is an empty output list.

Generated images are saved under:

```text
output/YYYYMMDD/
```

They also appear as a new `Media` item in the current UI session.

## Development

```bash
npm install
npm run dev
npm run check:secrets
npm run check
```

`npm run dev` configures the tracked `.githooks/pre-commit` hook for this checkout. The hook scans staged content, tracked files, and new non-ignored files for private runtime paths, common credential signatures, and exact locally saved API-key values. `npm run check` runs the same secret check before tests and the production build.

The frontend is React/Vite. The local API is Express.
