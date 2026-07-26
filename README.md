# Instagram Import Studio

Local web studio for turning Instagram photo posts, carousels, Reels, and local photo/video files into reusable source material for image and video generation. It imports Instagram media through Apify, creates editable prompts with Ollama Cloud or a local Ollama instance, and executes configurable RunningHub ComfyUI workflows through a persistent local queue.

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

Starting a launcher again stops the previous local application listeners on ports 4317 and 5173 before opening the new session. Processes using other ports are not stopped.

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

## Settings

Open the `Настройки` tab and save API settings there:

- Apify API token for Instagram photo and Reel imports.
- Ollama Cloud API key and reusable Cloud/Local prompt presets.
- RunningHub API key and reusable workflow presets.
- RunningHub execution mode (`Standard` or `Plus`) for each workflow.
- Node ID, field name, and Studio ID bindings that define every workflow input.
- Ordered Studio actions for text, image, and video generation.

API keys are shown in the UI only as a masked preview. Use **Вставить ключ** to replace a key and **Очистить** to remove it. The replacement field is always empty: the saved raw key is never loaded into the browser. The workflow JSON is managed in RunningHub and is not uploaded to this application.

RunningHub bindings are the source of truth for generation inputs:

| Studio ID | Input |
| --- | --- |
| `1` | Source image |
| `2` | Prompt belonging to the selected image |
| `3` | Source video |
| `4` | Generated image |
| `5` | Prompt belonging to the selected video |

Image and video prompts are stored separately in each queue job. A workflow using both IDs `2` and `5` therefore receives two independent prompt values.

The key is stored locally in:

```text
data/connections.local.json
```

`data/`, `input/`, `output/`, and `*.local.json` are ignored by git. On macOS and Linux, `connections.local.json` is created and repaired with owner-only `0600` permissions. The local API does not publish this file or the session index; only an allowlisted Apify metadata response can be opened through `/media/imports/...`.

Local persistence does not prevent the configured integrations from receiving data required to perform their work. Apify, Ollama Cloud, and RunningHub receive the data and credentials required for their respective calls; prompt instructions, selected images, workflow settings, and final prompts are sent only to the selected generation service, not to GitHub.

## Import Flow

1. Paste an Instagram photo post, carousel, or Reel URL in `Студия` and press `Import`, or use **Загрузить медиа** to select one or more local photo/video files.
2. The local API runs `apify/instagram-scraper` through Apify with the URL as the only input and a result limit of `1`; it uses the actor's Reel mode for Reel URLs.
3. The application saves photos, carousel items, and Reel MP4 files. For a Reel it also generates a local first-frame preview. Captions, comments, profile data, and other raw Apify response fields are discarded.
4. Downloaded or uploaded source media is stored under `input/`.

**Сброс** clears the current media session, preview, metadata, and prompt text, but keeps the Studio layout and persistent Generation workspace options. It does not delete files from `input/` or `output/`.

## Studio Flow

The `Media` panel supports selecting one or more materials for later generation. The active preview and selected generation inputs are separate: click a card to preview it, and use `Use` to include it in generation.

Reel videos and their first frames remain separate reusable materials. Images are labeled `IMAGE 1`, `IMAGE 2`, and so on; videos use an independent `REEL 1`, `REEL 2` sequence.

Press `Generate prompt` to send the selected source image to the model configured by the selected Ollama text action. Ollama Cloud and local Ollama presets are edited on the `Настройки` page.

Each generated prompt is displayed in a large editable field. Typing, undo, redo, reset, and an applied Generation workspace prefix are saved to the local current session after a short pause. You can also press **Сохранить** explicitly. Saved prompt text persists when the page is reloaded within the current media session, and image generation saves the exact latest text before sending it to RunningHub.

The **Generation workspace** selector stores reusable prefix variants in the format `Название;Текст`, one variant per line. When a variant is selected, the final prompt is `Текст, Image`, where `Image` is the generated or edited Ollama prompt. With **Не выбрано**, the Ollama prompt is used unchanged. These variants are saved in application settings and are not changed by **Сброс**.

Press `Image generation` or `Video generation` to create one independent queue job for every requested result. The selected RunningHub workflow determines which source image, source video, generated image, image prompt, and video prompt are sent through `nodeInfoList`.

The uploaded ComfyUI workflow must include an output-saving node connected to the final result. Preview-only nodes do not expose files through the RunningHub output API, so the app cannot download their results.

## Generation Queue

The `Queue` tab is the persistent source of truth for generation:

- jobs execute sequentially in a server worker;
- waiting jobs can be moved up or down;
- each card shows the frozen media and prompt recipe used by that job;
- each result is saved independently, so one failed job does not remove successful outputs;
- active RunningHub task IDs and queue states survive a page reload or server restart;
- cancellation remains in `canceling` until the provider confirms the terminal result;
- provider polling is shown as `Генерация`, and `Скачивание` starts only when output URLs are ready.

Completed images and videos are registered immediately and appear in `Generated Media` without waiting for the rest of the queue. Generated video thumbnails are created locally so results can be selected again as inputs.

Queue state is stored in a versioned local JSON file under `data/`. Writes use validation, serialized mutations, atomic replacement, and a backup. Only one server process should write these files.

Generated output files are saved under:

```text
output/YYYYMMDD/
```

Runtime data, generated media, queue state, and connection settings remain local and are ignored by git.

## Development

```bash
npm install
npm run dev
npm run check:secrets
npm run check
```

`npm run dev` configures the tracked `.githooks/pre-commit` hook for this checkout. The hook scans staged content, tracked files, and new non-ignored files for private runtime paths, common credential signatures, and exact locally saved API-key values. `npm run check` runs the same secret check before tests and the production build.

The frontend is React/Vite. The local API is Express.
