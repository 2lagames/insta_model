import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { SceneBible } from "../src/lib/importTypes";

export const defaultOllamaModel = process.env.OLLAMA_MODEL ?? "fredrezones55/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b";
const defaultOllamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

type FetchLike = typeof fetch;
type StatusCallback = (event: { tone: "running" | "ready" | "error"; message: string; source: "ollama" | "prompt" }) => void;

export type PromptMediaInput = {
  id: string;
  label: string;
  imagePath: string;
  sourceKind: "photo" | "video-first-frame";
  caption?: string;
  sceneBibleId?: string;
  sceneBible?: SceneBible;
};

export type BuildOllamaVisionRequestInput = {
  model: string;
  imageBase64: string;
  sourceKind: PromptMediaInput["sourceKind"];
  caption?: string;
  sceneBible?: SceneBible;
};

export type OllamaVisionRequest = {
  model: string;
  stream: false;
  format: "json";
  images: string[];
  prompt: string;
  options: {
    temperature: number;
  };
};

export type GenerateIdeogramPromptOptions = {
  inputDir: string;
  media: PromptMediaInput[];
  model?: string;
  ollamaBaseUrl?: string;
  fetchImpl?: FetchLike;
  onStatus?: StatusCallback;
};

type OllamaGenerateResponse = {
  response?: string;
  error?: string;
};

export function buildOllamaVisionRequest(input: BuildOllamaVisionRequestInput): OllamaVisionRequest {
  return {
    model: input.model,
    stream: false,
    format: "json",
    images: [input.imageBase64],
    options: {
      temperature: 0.2
    },
    prompt: [
      "You are an Ideogram 4 JSON prompt generator.",
      "",
      "Describe the attached image exactly as it is visible.",
      "Do not replace the person identity, do not transform the person into another identity, and do not add traits that are not visible.",
      "Do not invent unrelated new elements.",
      "Use the image itself as the only visual source of truth. The Instagram caption is optional context only.",
      "Output must follow the Ideogram 4.0 structured JSON caption schema.",
      "Ideogram gives more weight to earlier prompt details, so put the most important visible subject and setting information first.",
      "Ideogram works best with clear, visually grounded, natural-language descriptions: shapes, colors, materials, lighting, background, pose, framing, and concrete spatial relationships.",
      "Avoid vague words such as beautiful, interesting, cool, modern, artistic unless they are backed by concrete visual details.",
      "Return valid JSON only. No markdown, no comments, no explanations, no code fences.",
      "",
      "Use this exact top-level JSON structure:",
      "{",
      "  \"high_level_description\": \"One compact visual summary of the final image.\",",
      "  \"style_description\": {",
      "    \"aesthetics\": \"Concise visual aesthetic keywords.\",",
      "    \"lighting\": \"Concrete lighting description.\",",
      "    \"photo\": \"Camera angle, crop, lens/perspective, and shot type.\",",
      "    \"medium\": \"photograph\",",
      "    \"color_palette\": [\"#RRGGBB\", \"#RRGGBB\", \"#RRGGBB\"]",
      "  },",
      "  \"compositional_deconstruction\": {",
      "    \"background\": \"Environment and background description.\",",
      "    \"elements\": [",
      "      {",
      "        \"type\": \"obj\",",
      "        \"bbox\": [0, 0, 1000, 1000],",
      "        \"desc\": \"Detailed natural-language description of one visible subject, object, prop, garment, body area, or environmental element.\",",
      "        \"color_palette\": [\"#RRGGBB\"]",
      "      },",
      "      {",
      "        \"type\": \"text\",",
      "        \"bbox\": [0, 0, 1000, 1000],",
      "        \"text\": \"EXACT VISIBLE TEXT\",",
      "        \"desc\": \"Typeface, size, color, position, and layout of visible in-image text.\",",
      "        \"color_palette\": [\"#RRGGBB\"]",
      "      }",
      "    ]",
      "  }",
      "}",
      "",
      "Ideogram composition requirements:",
      "- high_level_description must follow this order: Image summary -> main subject -> pose or action -> secondary elements -> setting/background -> lighting/atmosphere -> framing/composition.",
      "- Keep high_level_description under 45 words so key information stays near the beginning.",
      "- background comes before elements and describes only the environment/backdrop.",
      "- Use obj elements for visible people, body/pose regions, garments, props, furniture, windows, surfaces, and scene anchors.",
      "- Use text elements only for readable text that is visibly present in the image; quote exact visible text in the text field.",
      "- Keep each element desc visually concrete and preferably under 45 words.",
      "- Use per-element color_palette only when it helps preserve important colors; use at most 5 uppercase #RRGGBB colors per element.",
      "- Use the global color_palette for dominant image colors, including background colors, highlights, and shadow tones; use at most 16 uppercase #RRGGBB colors.",
      "- Use affirmative visual wording. Replace absence/negative wording with the visible positive state when possible.",
      "- Do not copy negative constraints into the output JSON; translate them into positive preservation details.",
      "",
      "JSON requirements:",
      "- bbox values are normalized integer coordinates in [y_min, x_min, y_max, x_max] order, each from 0 to 1000.",
      "- Include the main visible subject, important body/pose regions, clothing or coverings, key furniture, props, windows, and background areas as separate elements when useful.",
      "- Each element desc must mention only visible details inside that element.",
      "- Do not describe hidden facial features, hidden body parts, or hidden clothing.",
      "- Use uppercase #RRGGBB hex colors.",
      "- The JSON must be parseable and must not include trailing commas.",
      "",
      ...(input.sceneBible ? [
        "lockedSceneBible:",
        JSON.stringify(input.sceneBible.lockedJson, null, 2),
        "",
        "Scene consistency hard constraints:",
        ...getSceneLayoutRules(input.sceneBible.lockedJson).map((rule) => `- ${rule}`),
        "",
        "Surface pattern locks:",
        ...getSurfacePatternRules(input.sceneBible.lockedJson).map((rule) => `- ${rule}`),
        "",
        "Forbidden scene drift rules:",
        ...getForbiddenSceneDriftRules(input.sceneBible.lockedJson).map((rule) => `- ${rule}`),
        "",
        "Locked scene rules:",
        "- Do not invent a different location.",
        "- Preserve lockedSceneBible location, lighting, palette, environment type, and major background objects.",
        "- Do not remove, replace, or rename locked background objects unless the attached image clearly shows they are absent.",
        "- Preserve surface pattern orientation, scale, material, color family, and placement when specified.",
        "- Preserve approximate bbox placement of stable background anchors when specified.",
        "- Change only pose, framing, person placement, camera angle, and shot-specific foreground details.",
        "- Do not copy negative locked-scene rules into output JSON; rewrite them as positive visible scene-preservation details.",
        ""
      ] : []),
      `- Source kind: ${input.sourceKind}.`,
      input.caption ? `- Instagram caption context: ${input.caption}` : "- No Instagram caption context was provided."
    ].join("\n")
  };
}

function getLockedJsonStringArray(value: Record<string, unknown>, path: string[]): string[] {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return [];
    }
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : [];
}

function getSceneLayoutRules(value: Record<string, unknown>): string[] {
  const explicitRules = getLockedJsonStringArray(value, ["scene_consistency", "layout_locks"]);
  if (explicitRules.length > 0) {
    return explicitRules;
  }

  return getLegacySceneAnchorRules(value);
}

function getForbiddenSceneDriftRules(value: Record<string, unknown>): string[] {
  const explicitRules = getLockedJsonStringArray(value, ["scene_consistency", "forbidden_scene_changes"]);
  if (explicitRules.length > 0) {
    return explicitRules;
  }

  return [
    "Do not replace the locked background with a different location type.",
    "Do not introduce a new dominant background that is not present in the locked scene.",
    "Do not change the dominant surface pattern, material, or color family from the locked scene.",
    "Do not remove the main stable background anchors described in lockedSceneBible."
  ];
}

function getLegacySceneAnchorRules(value: Record<string, unknown>): string[] {
  const composition = value.compositional_deconstruction;
  if (!composition || typeof composition !== "object") {
    return [];
  }
  const elements = (composition as Record<string, unknown>).elements;
  if (!Array.isArray(elements)) {
    return [];
  }
  return elements
    .flatMap((element) => {
      if (!element || typeof element !== "object") {
        return [];
      }
      const record = element as Record<string, unknown>;
      const desc = typeof record.desc === "string" ? record.desc : "";
      const bbox = Array.isArray(record.bbox) ? ` at approximate bbox [${record.bbox.join(", ")}]` : "";
      return desc ? [`Preserve legacy scene anchor: ${desc}${bbox}.`] : [];
    })
    .slice(0, 12);
}

function getSurfacePatternRules(value: Record<string, unknown>): string[] {
  const sceneConsistency = value.scene_consistency;
  if (!sceneConsistency || typeof sceneConsistency !== "object") {
    return [];
  }
  const surfacePatterns = (sceneConsistency as Record<string, unknown>).surface_patterns;
  if (!Array.isArray(surfacePatterns)) {
    return [];
  }
  return surfacePatterns.flatMap((pattern) => {
    if (!pattern || typeof pattern !== "object") {
      return [];
    }
    const record = pattern as Record<string, unknown>;
    const surface = typeof record.surface === "string" ? record.surface : "surface";
    const patternType = typeof record.pattern_type === "string" ? record.pattern_type : "same pattern";
    const orientation = typeof record.orientation === "string" ? record.orientation : "same orientation";
    const scale = typeof record.scale === "string" ? record.scale : "same scale";
    const forbidden = Array.isArray(record.forbidden_alternatives)
      ? record.forbidden_alternatives.filter((item): item is string => typeof item === "string")
      : [];
    return [
      `Preserve ${surface}: ${patternType}, ${orientation}, ${scale}.`,
      ...forbidden.map((item) => `Do not replace ${surface} with ${item}.`)
    ];
  });
}

export async function generateIdeogramPromptForMedia(options: GenerateIdeogramPromptOptions): Promise<string> {
  if (options.media.length === 0) {
    throw new Error("Select one or more Media items before image generation.");
  }

  const model = options.model ?? defaultOllamaModel;
  const ollamaBaseUrl = options.ollamaBaseUrl ?? defaultOllamaBaseUrl;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!options.fetchImpl) {
    await ensureOllamaModel({ model, ollamaBaseUrl, fetchImpl, onStatus: options.onStatus });
  }

  const prompts = [];
  for (const [index, media] of options.media.entries()) {
    options.onStatus?.({
      tone: "running",
      source: "prompt",
      message: `Reading ${media.label} (${index + 1}/${options.media.length}) for Ideogram prompt generation.`
    });
    const imageBase64 = await readFile(resolveInputPath(options.inputDir, media.imagePath), "base64");
    options.onStatus?.({
      tone: "running",
      source: "prompt",
      message: `Sending ${media.label} (${index + 1}/${options.media.length}) to Ollama vision model for Ideogram JSON.`
    });
    const response = await safeFetch(fetchImpl, new URL("/api/generate", ollamaBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOllamaVisionRequest({
        model,
        imageBase64,
        sourceKind: media.sourceKind,
        caption: media.caption,
        sceneBible: media.sceneBible
      }))
    }, "generating Ideogram JSON prompt");

    if (!response.ok) {
      throw new Error(`Ollama prompt generation failed with ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as OllamaGenerateResponse;
    if (payload.error) {
      throw new Error(`Ollama prompt generation failed: ${payload.error}`);
    }

    const promptText = parseAndFormatIdeogramJson(payload.response ?? "");
    options.onStatus?.({
      tone: "ready",
      source: "prompt",
      message: `Ideogram JSON prompt generated for ${media.label} (${index + 1}/${options.media.length}).`
    });
    prompts.push({
      mediaId: media.id,
      label: media.label,
      prompt: promptText
    });
  }

  if (prompts.length === 1) {
    return prompts[0]?.prompt ?? "";
  }

  return JSON.stringify(prompts, null, 2);
}

function parseAndFormatIdeogramJson(rawResponse: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
  } catch {
    throw new Error("Ollama returned invalid Ideogram JSON.");
  }

  assertIdeogramJson(parsed);
  return JSON.stringify(parsed, null, 2);
}

function assertIdeogramJson(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Ideogram JSON output must be an object.");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.high_level_description !== "string") {
    throw new Error("Ideogram JSON is missing high_level_description.");
  }
  if (!record.style_description || typeof record.style_description !== "object") {
    throw new Error("Ideogram JSON is missing style_description.");
  }
  if (!record.compositional_deconstruction || typeof record.compositional_deconstruction !== "object") {
    throw new Error("Ideogram JSON is missing compositional_deconstruction.");
  }

  const style = record.style_description as Record<string, unknown>;
  if (
    typeof style.aesthetics !== "string" ||
    typeof style.lighting !== "string" ||
    typeof style.photo !== "string" ||
    typeof style.medium !== "string" ||
    !Array.isArray(style.color_palette)
  ) {
    throw new Error("Ideogram JSON style_description is incomplete.");
  }
  assertColorPalette(style.color_palette, 16, "style_description.color_palette");

  const composition = record.compositional_deconstruction as Record<string, unknown>;
  if (typeof composition.background !== "string" || !Array.isArray(composition.elements)) {
    throw new Error("Ideogram JSON compositional_deconstruction must include background and elements.");
  }

  for (const [index, element] of composition.elements.entries()) {
    if (!element || typeof element !== "object") {
      throw new Error(`Ideogram JSON element ${index + 1} must be an object.`);
    }
    const elementRecord = element as Record<string, unknown>;
    if ((elementRecord.type !== "obj" && elementRecord.type !== "text") || typeof elementRecord.desc !== "string") {
      throw new Error(`Ideogram JSON element ${index + 1} must include type and desc.`);
    }
    if (elementRecord.type === "text" && typeof elementRecord.text !== "string") {
      throw new Error(`Ideogram JSON text element ${index + 1} must include text.`);
    }
    if (!Array.isArray(elementRecord.bbox) || elementRecord.bbox.length !== 4 || !elementRecord.bbox.every(isNormalizedInteger)) {
      throw new Error(`Ideogram JSON element ${index + 1} must include normalized bbox [y_min,x_min,y_max,x_max].`);
    }
    if (elementRecord.color_palette !== undefined) {
      assertColorPalette(elementRecord.color_palette, 5, `element ${index + 1} color_palette`);
    }
  }
}

function assertColorPalette(value: unknown, maxColors: number, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Ideogram JSON ${label} must be a color array.`);
  }
  if (value.length > maxColors) {
    throw new Error(`Ideogram JSON ${label} must include at most ${maxColors} colors.`);
  }
  for (const color of value) {
    if (typeof color !== "string" || !/^#[0-9A-F]{6}$/.test(color)) {
      throw new Error(`Ideogram JSON ${label} must use uppercase #RRGGBB colors.`);
    }
  }
}

function isNormalizedInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
}

function resolveInputPath(inputDir: string, publicPath: string): string {
  if (!publicPath.startsWith("/input/")) {
    throw new Error(`Only local /input media can be used for prompt generation: ${publicPath}`);
  }

  const absoluteInputDir = resolve(inputDir);
  const absolutePath = resolve(join(absoluteInputDir, publicPath.slice("/input/".length)));
  const rel = relative(absoluteInputDir, absolutePath);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Invalid input media path: ${publicPath}`);
  }

  return absolutePath;
}

export async function ensureOllamaModel(options: {
  model: string;
  ollamaBaseUrl: string;
  fetchImpl: FetchLike;
  onStatus?: StatusCallback;
}): Promise<void> {
  options.onStatus?.({
    tone: "running",
    source: "ollama",
    message: `Checking Ollama server at ${options.ollamaBaseUrl}.`
  });
  await ensureOllamaServer(options.ollamaBaseUrl, options.fetchImpl);

  const tags = await safeFetch(
    options.fetchImpl,
    new URL("/api/tags", options.ollamaBaseUrl),
    undefined,
    "checking installed models"
  );
  if (!tags.ok) {
    throw new Error(`Ollama is running but /api/tags failed with ${tags.status}.`);
  }

  const data = await tags.json() as { models?: Array<{ name?: string }> };
  const modelNames = data.models?.map((model) => model.name).filter(Boolean) ?? [];
  if (modelNames.some((name) => name === options.model || name?.startsWith(`${options.model}:`))) {
    options.onStatus?.({
      tone: "ready",
      source: "ollama",
      message: `Ollama model ${options.model} is already installed.`
    });
    return;
  }

  options.onStatus?.({
    tone: "running",
    source: "ollama",
    message: `Ollama model ${options.model} is not installed. Starting download.`
  });
  const pull = await safeFetch(options.fetchImpl, new URL("/api/pull", options.ollamaBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: options.model, stream: true })
  }, `downloading model ${options.model}`);

  if (!pull.ok) {
    throw new Error(`Could not pull Ollama model ${options.model}: ${await pull.text()}`);
  }

  await readOllamaPullProgress(pull, options.onStatus);
  options.onStatus?.({
    tone: "ready",
    source: "ollama",
    message: `Ollama model ${options.model} is ready.`
  });
}

async function ensureOllamaServer(ollamaBaseUrl: string, fetchImpl: FetchLike): Promise<void> {
  if (await canReachOllama(ollamaBaseUrl, fetchImpl)) {
    return;
  }

  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
    throw new Error("Ollama is not installed. Run ./start.sh so the bootstrap script can install it, then retry.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (await canReachOllama(ollamaBaseUrl, fetchImpl)) {
      return;
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 500));
  }

  throw new Error("Ollama server did not start within 20 seconds.");
}

async function canReachOllama(ollamaBaseUrl: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL("/api/tags", ollamaBaseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function safeFetch(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit | undefined,
  action: string
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Ollama request failed while ${action}: ${message}`);
  }
}

async function readOllamaPullProgress(response: Response, onStatus: StatusCallback | undefined): Promise<void> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastMessage = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const message = formatOllamaPullLine(line);
      if (message && message !== lastMessage) {
        lastMessage = message;
        onStatus?.({ tone: "running", source: "ollama", message });
      }
    }
  }

  const finalMessage = formatOllamaPullLine(buffer);
  if (finalMessage && finalMessage !== lastMessage) {
    onStatus?.({ tone: "running", source: "ollama", message: finalMessage });
  }
}

function formatOllamaPullLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const payload = JSON.parse(trimmed) as {
      status?: string;
      completed?: number;
      total?: number;
      error?: string;
    };
    if (payload.error) {
      return `Ollama: ${payload.error}`;
    }
    if (!payload.status) {
      return undefined;
    }
    if (payload.total && payload.completed !== undefined && payload.total > 0) {
      const percent = Math.max(0, Math.min(100, Math.floor((payload.completed / payload.total) * 100)));
      return `Ollama: ${payload.status} ${percent}%`;
    }
    return `Ollama: ${payload.status}`;
  } catch {
    return `Ollama: ${trimmed}`;
  }
}
