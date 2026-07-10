# Instagram Import Studio

Local web studio for turning Instagram posts and Reels into reusable source material for a content-production workflow. It downloads photos, carousel items, video first frames, captions, and metadata through ScrapeCreators; prepares structured image prompts locally with Ollama; and can send those prompts to a RunningHub ComfyUI workflow.

It is designed for creators who need to revisit the same reference post without repeatedly downloading the same assets. Normal imports reuse healthy local media; use **Обновить заново** only when a fresh download is needed.

## Run

Double-click the launcher for your operating system:

| System | File |
| --- | --- |
| Windows | `start.bat` |
| macOS | `start.command` |

The launcher opens a terminal window, installs npm dependencies on the first run, then opens the project in the default browser at <http://localhost:5173>. Leave that terminal window open while working. Closing it stops the local server.

Both launchers show a clear message if Node.js/npm is missing. Install the current LTS version from <https://nodejs.org/>, then run the launcher again.

## Update

```bash
./update.sh
```

## Connections

Open the `Подключения` tab and save API settings there:

- ScrapeCreators API key for Instagram imports.
- RunningHub API key for ComfyUI generation.
- RunningHub workflow ID.
- Prompt node ID and prompt field name for replacing the workflow prompt.
- Workflow `.json` file.

The key is stored locally in:

```text
data/connections.local.json
```

`data/`, `input/`, `output/`, and `*.local.json` are ignored by git, so secrets and generated/imported media should not be published to GitHub.

## Import Flow

1. Paste an Instagram post or Reels URL in `Студия`.
2. Press `Import`.
3. The local API calls ScrapeCreators `GET /v1/instagram/post` with `download_media=true`.
4. Photos, carousel items, videos, first-frame thumbnails, and caption text appear in the interface.
5. Downloaded source media is stored under `input/YYYYMMDD/<import-id>/`.

## Image Prompt Flow

The `Media` panel supports selecting one or more materials for later generation. The active preview and the selected generation queue are separate: click a card to preview it, use `Use` to include it in prompt generation.

Press `Generate prompt` to test local Ollama prompt generation without sending anything to RunningHub.

Press `Image generation` to generate the prompt locally through Ollama and then send it to RunningHub. The default model is:

```text
fredrezones55/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b
```

The generated prompt is written into `Log`, then sent to RunningHub through `POST /task/openapi/create` using `nodeInfoList` to replace the configured prompt node field. The task payload requests RunningHub Plus with `instanceType: "plus"`.

The uploaded ComfyUI workflow must include a `SaveImage` node connected to the final image. `PreviewImage` is useful inside ComfyUI, but it does not expose files through RunningHub `/task/openapi/outputs`, so the app cannot download generated images from preview-only workflows. Do not connect `SaveImage.images` to `PreviewImage`; connect it to the same final image source that feeds preview, for example `VAEDecode` or the final image pass-through node.

After a RunningHub task reaches `SUCCESS`, the app polls outputs up to 12 times by default. Override this with `RUNNINGHUB_OUTPUT_MAX_POLLS` if RunningHub needs more time to expose saved files.

Prompt output format is valid JSON shaped for Ideogram 4 prompting:

```json
{
  "high_level_description": "One or two sentence visual summary of the input image.",
  "style_description": {
    "aesthetics": "Concise visual aesthetic keywords.",
    "lighting": "Concrete lighting description.",
    "photo": "Camera angle, crop, lens/perspective, and shot type.",
    "medium": "photograph",
    "color_palette": ["#F5F0E8", "#B69B7A", "#2F2A24"]
  },
  "compositional_deconstruction": {
    "background": "Environment and background description.",
    "elements": [
      {
        "type": "obj",
        "bbox": [330, 80, 940, 890],
        "desc": "Detailed description of one visible subject, object, prop, garment, body area, or environmental element."
      }
    ]
  }
}
```

`bbox` values are normalized integer coordinates from 0 to 1000 in `[y_min, x_min, y_max, x_max]` order. Prompt generation describes the selected input image as it is visible; it no longer applies a saved target model identity or hidden-trait replacement pass.

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
npm run check
```

The frontend is React/Vite. The local API is Express.
