import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  CurrentMediaSession,
  SceneBible,
  SceneEnvironmentKind,
  SceneLocationSignature,
  ScenePersistentElement,
  SceneSurfacePattern
} from "../src/lib/importTypes";
import type { PromptMediaInput } from "../src/lib/promptTypes";
import { defaultOllamaModel, ensureOllamaModel } from "./ideogramPrompt";

type FetchLike = typeof fetch;
type StatusCallback = (event: { tone: "running" | "ready" | "error"; message: string; source: "ollama" | "prompt" | "scene" }) => void;

type SceneAnalysisMedia = {
  mediaId: string;
  locationSignature: SceneLocationSignature;
};

type SceneAnalysisResponse = {
  media: SceneAnalysisMedia[];
};

type SceneGroup = {
  mediaIds: string[];
  signatures: SceneLocationSignature[];
};

type OllamaGenerateResponse = {
  response?: string;
  error?: string;
};

const defaultOllamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const sceneAnalysisBatchSize = 2;

export function parseSceneAnalysisResponse(rawResponse: string): SceneAnalysisResponse {
  const parsed = parseLooseJson(rawResponse);
  const normalized = Array.isArray(parsed) ? { media: parsed } : parsed;

  if (!normalized || typeof normalized !== "object" || !Array.isArray((normalized as Record<string, unknown>).media)) {
    throw new Error("Ollama returned invalid scene analysis JSON.");
  }

  const media = (normalized as { media: unknown[] }).media.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Scene analysis media item ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const mediaId = typeof record.mediaId === "string" ? record.mediaId : "";
    if (!mediaId) {
      throw new Error(`Scene analysis media item ${index + 1} is missing mediaId.`);
    }
    return {
      mediaId,
      locationSignature: parseLocationSignature(record.locationSignature, index + 1)
    };
  });

  return { media };
}

export function groupSceneSignatures(media: SceneAnalysisMedia[]): SceneGroup[] {
  const groups: SceneGroup[] = [];

  for (const item of media) {
    const matchingGroup = groups.find((group) => signaturesAreSimilar(group.signatures[0], item.locationSignature));
    if (matchingGroup) {
      matchingGroup.mediaIds.push(item.mediaId);
      matchingGroup.signatures.push(item.locationSignature);
    } else {
      groups.push({
        mediaIds: [item.mediaId],
        signatures: [item.locationSignature]
      });
    }
  }

  return groups;
}

export async function generateSceneBiblesForImport(options: {
  inputDir: string;
  media: PromptMediaInput[];
  model?: string;
  ollamaBaseUrl?: string;
  fetchImpl?: FetchLike;
  readImageBase64?: (imagePath: string) => Promise<string>;
  onStatus?: StatusCallback;
}): Promise<Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap">> {
  const media = options.media.filter((item) => item.imagePath);
  if (media.length === 0) {
    return { sceneBibles: [], mediaSceneMap: {} };
  }

  const model = options.model ?? defaultOllamaModel;
  const ollamaBaseUrl = options.ollamaBaseUrl ?? defaultOllamaBaseUrl;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!options.fetchImpl) {
    await ensureOllamaModel({ model, ollamaBaseUrl, fetchImpl, onStatus: options.onStatus });
  }

  options.onStatus?.({
    tone: "running",
    source: "scene",
    message: `Analyzing location consistency for ${media.length} media item(s).`
  });

  const images = [];
  for (const item of media) {
    const imagePath = resolveInputPath(options.inputDir, item.imagePath);
    images.push(options.readImageBase64 ? await options.readImageBase64(imagePath) : await readFile(imagePath, "base64"));
  }

  const analysisMedia: SceneAnalysisMedia[] = [];
  const batches = createSceneAnalysisBatches(media, images);

  for (const [index, batch] of batches.entries()) {
    if (batches.length > 1) {
      options.onStatus?.({
        tone: "running",
        source: "scene",
        message: `Analyzing location batch ${index + 1}/${batches.length} (${batch.media.length} media item(s)).`
      });
    }

    try {
      const analysis = await requestSceneAnalysisBatch({
        model,
        media: batch.media,
        images: batch.images,
        ollamaBaseUrl,
        fetchImpl
      });
      analysisMedia.push(...withFallbackForMissingMedia(batch.media, analysis.media));
    } catch (error) {
      options.onStatus?.({
        tone: "error",
        source: "scene",
        message: `Scene analysis batch ${index + 1}/${batches.length} failed. Using fallback scene data for this batch. ${error instanceof Error ? error.message : ""}`.trim()
      });
      analysisMedia.push(...createFallbackSceneAnalysisMedia(batch.media));
    }
  }

  const { sceneBibles, mediaSceneMap } = createSceneBiblesFromAnalysis(analysisMedia);
  options.onStatus?.({
    tone: "ready",
    source: "scene",
    message: `Scene analysis complete: ${sceneBibles.length} scene bible(s).`
  });

  return { sceneBibles, mediaSceneMap };
}

function createSceneAnalysisBatches(media: PromptMediaInput[], images: string[]): Array<{ media: PromptMediaInput[]; images: string[] }> {
  const batches = [];
  for (let index = 0; index < media.length; index += sceneAnalysisBatchSize) {
    batches.push({
      media: media.slice(index, index + sceneAnalysisBatchSize),
      images: images.slice(index, index + sceneAnalysisBatchSize)
    });
  }
  return batches;
}

async function requestSceneAnalysisBatch(input: {
  model: string;
  media: PromptMediaInput[];
  images: string[];
  ollamaBaseUrl: string;
  fetchImpl: FetchLike;
}): Promise<SceneAnalysisResponse> {
  const response = await input.fetchImpl(new URL("/api/generate", input.ollamaBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildSceneAnalysisRequest({
      model: input.model,
      media: input.media,
      images: input.images
    }))
  });

  if (!response.ok) {
    throw new Error(`Ollama scene analysis failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as OllamaGenerateResponse;
  if (payload.error) {
    throw new Error(`Ollama scene analysis failed: ${payload.error}`);
  }

  return parseSceneAnalysisResponse(payload.response ?? "");
}

function withFallbackForMissingMedia(media: PromptMediaInput[], analyzedMedia: SceneAnalysisMedia[]): SceneAnalysisMedia[] {
  const validIds = new Set(media.map((item) => item.id));
  const analyzedForBatch = analyzedMedia.filter((item) => validIds.has(item.mediaId));
  const analyzedIds = new Set(analyzedForBatch.map((item) => item.mediaId));
  return [
    ...analyzedForBatch,
    ...createFallbackSceneAnalysisMedia(media.filter((item) => !analyzedIds.has(item.id)))
  ];
}

function parseLooseJson(rawResponse: string): unknown {
  const trimmed = rawResponse.trim();
  if (!trimmed) {
    throw new Error("Ollama returned empty scene analysis JSON.");
  }

  const candidates = [
    trimmed,
    extractFencedJson(trimmed),
    extractBalancedJson(trimmed, "{", "}"),
    extractBalancedJson(trimmed, "[", "]")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // Try the next likely JSON fragment.
    }
  }

  throw new Error("Ollama returned invalid scene analysis JSON.");
}

function extractFencedJson(value: string): string | undefined {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function extractBalancedJson(value: string, open: "{" | "[", close: "}" | "]"): string | undefined {
  const start = value.indexOf(open);
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function buildSceneAnalysisRequest(input: {
  model: string;
  media: PromptMediaInput[];
  images: string[];
}) {
  return {
    model: input.model,
    stream: false,
    format: "json",
    images: input.images,
    options: {
      temperature: 0.1
    },
    prompt: [
      "You are a location analysis engine for a visual content pipeline.",
      "Analyze only fixed location, background, lighting, colors, and stable objects.",
      "Ignore the person's identity, face, body, skin, clothing, pose, and expression.",
      "Return JSON only. No markdown, no comments, no code fences.",
      "",
      "Return exactly this structure:",
      "{",
      "  \"media\": [",
      "    {",
      "      \"mediaId\": \"the exact media id from the list below\",",
      "      \"locationSignature\": {",
      "        \"locationType\": \"short concrete location archetype\",",
      "        \"environmentKind\": \"interior | exterior | mixed | unknown\",",
      "        \"keyObjects\": [\"3 to 8 stable background objects\"],",
      "        \"lighting\": \"short concrete lighting description\",",
      "        \"palette\": [\"3 to 6 short color names\"],",
      "        \"mood\": \"short visual mood\",",
      "        \"persistentElements\": [",
      "          {",
      "            \"name\": \"stable object/surface/landmark name\",",
      "            \"category\": \"background | surface | fixture | furniture | landmark | plant | prop | architecture | terrain | other\",",
      "            \"bbox\": [0, 0, 1000, 1000],",
      "            \"position\": \"where it sits in the frame\",",
      "            \"visualDetails\": [\"shape, material, color, pattern, scale, orientation details\"],",
      "            \"mustPreserve\": [\"short rules for preserving this element\"]",
      "          }",
      "        ],",
      "        \"surfacePatterns\": [",
      "          {",
      "            \"surface\": \"stable background surface\",",
      "            \"bbox\": [0, 0, 1000, 1000],",
      "            \"patternType\": \"grass, vertical tile grid, linen folds, skyline grid, water ripples, etc.\",",
      "            \"orientation\": \"dominant direction or arrangement\",",
      "            \"scale\": \"fine / medium / large and approximate visual density\",",
      "            \"colors\": [\"surface colors\"],",
      "            \"forbiddenAlternatives\": [\"generic alternatives that would change the scene identity\"]",
      "          }",
      "        ],",
      "        \"layoutLocks\": [\"spatial facts that must stay stable across generated shots\"],",
      "        \"forbiddenSceneChanges\": [\"generic scene drift changes to avoid for this specific location\"]",
      "      }",
      "    }",
      "  ]",
      "}",
      "",
      "Media ids in image order:",
      ...input.media.map((item, index) => `${index + 1}. ${item.id} (${item.label})`)
    ].join("\n")
  };
}

function createSceneBiblesFromAnalysis(media: SceneAnalysisMedia[]): Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap"> {
  const groups = groupSceneSignatures(media);
  const sceneBibles: SceneBible[] = groups.map((group, index) => {
    const signature = mergeSignatures(group.signatures);
    const id = `scene_${String(index + 1).padStart(3, "0")}_${slugify(signature.locationType || "location")}`;
    return {
      id,
      name: createSceneName(signature, index),
      sourceMediaIds: group.mediaIds,
      locationSignature: signature,
      lockedJson: createLockedSceneJson(signature)
    };
  });

  const mediaSceneMap = Object.fromEntries(
    sceneBibles.flatMap((scene) => scene.sourceMediaIds.map((mediaId) => [mediaId, scene.id]))
  );

  return { sceneBibles, mediaSceneMap };
}

export function createFallbackSceneData(media: PromptMediaInput[]): Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap"> {
  if (media.length === 0) {
    return { sceneBibles: [], mediaSceneMap: {} };
  }

  const signature = createFallbackLocationSignature();
  const sceneBible: SceneBible = {
    id: "scene_001_source_media_location",
    name: "Source Media Location",
    sourceMediaIds: media.map((item) => item.id),
    locationSignature: signature,
    lockedJson: createLockedSceneJson(signature)
  };

  return {
    sceneBibles: [sceneBible],
    mediaSceneMap: Object.fromEntries(media.map((item) => [item.id, sceneBible.id]))
  };
}

function createFallbackSceneAnalysisMedia(media: PromptMediaInput[]): SceneAnalysisMedia[] {
  return media.map((item) => ({
    mediaId: item.id,
    locationSignature: createFallbackLocationSignature()
  }));
}

function createFallbackLocationSignature(): SceneLocationSignature {
  return {
    locationType: "source media location",
    environmentKind: "unknown",
    keyObjects: ["stable source background", "visible location anchors", "dominant source surfaces"],
    lighting: "preserve the source media lighting",
    palette: ["source colors", "natural tones", "realistic contrast"],
    mood: "source visual mood",
    persistentElements: [{
      name: "source location anchors",
      category: "background",
      bbox: [0, 0, 1000, 1000],
      position: "same visible background positions from the selected source media",
      visualDetails: ["preserve the visible location structure", "preserve dominant surfaces and materials"],
      mustPreserve: ["Do not replace the source location with a different environment."]
    }],
    surfacePatterns: [{
      surface: "dominant source surfaces",
      bbox: [0, 0, 1000, 1000],
      patternType: "same visible surface pattern from the source media",
      orientation: "same dominant orientation as the source media",
      scale: "same visual scale and density as the source media",
      colors: ["source colors"],
      forbiddenAlternatives: ["generic studio backdrop", "unrelated room", "unrelated outdoor location"]
    }],
    layoutLocks: [
      "Use the selected source media as the location lock.",
      "Preserve the same environment type, dominant background structure, and visible surfaces from the selected source media.",
      "Do not invent a new location when scene analysis is unavailable."
    ],
    forbiddenSceneChanges: [
      "Do not change the source media location into a different room, city, landscape, studio, or generic backdrop.",
      "Do not replace dominant visible surfaces with unrelated materials.",
      "Do not add new large background objects that change the scene identity."
    ]
  };
}

function parseLocationSignature(value: unknown, index: number): SceneLocationSignature {
  if (!value || typeof value !== "object") {
    throw new Error(`Scene analysis media item ${index} is missing locationSignature.`);
  }
  const record = value as Record<string, unknown>;
  const environmentKind = parseEnvironmentKind(record.environmentKind);
  return {
    locationType: readString(record.locationType, "unknown location"),
    environmentKind,
    keyObjects: readStringArray(record.keyObjects),
    lighting: readString(record.lighting, "unspecified lighting"),
    palette: readStringArray(record.palette),
    mood: readString(record.mood, "natural"),
    persistentElements: parsePersistentElements(record.persistentElements),
    surfacePatterns: parseSurfacePatterns(record.surfacePatterns),
    layoutLocks: readStringArray(record.layoutLocks),
    forbiddenSceneChanges: readStringArray(record.forbiddenSceneChanges)
  };
}

function parseEnvironmentKind(value: unknown): SceneEnvironmentKind {
  return value === "interior" || value === "exterior" || value === "mixed" ? value : "unknown";
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function parsePersistentElements(value: unknown): ScenePersistentElement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ScenePersistentElement | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const name = readString(record.name, "");
      if (!name) {
        return undefined;
      }
      return {
        name,
        category: parsePersistentElementCategory(record.category),
        bbox: parseBbox(record.bbox),
        position: readString(record.position, "stable position in the scene"),
        visualDetails: readStringArray(record.visualDetails),
        mustPreserve: readStringArray(record.mustPreserve)
      };
    })
    .filter((item): item is ScenePersistentElement => Boolean(item));
}

function parseSurfacePatterns(value: unknown): SceneSurfacePattern[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): SceneSurfacePattern | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const surface = readString(record.surface, "");
      if (!surface) {
        return undefined;
      }
      return {
        surface,
        bbox: parseBbox(record.bbox),
        patternType: readString(record.patternType, "stable surface pattern"),
        orientation: readString(record.orientation, "consistent orientation"),
        scale: readString(record.scale, "consistent scale"),
        colors: readStringArray(record.colors),
        forbiddenAlternatives: readStringArray(record.forbiddenAlternatives)
      };
    })
    .filter((item): item is SceneSurfacePattern => Boolean(item));
}

function parsePersistentElementCategory(value: unknown): ScenePersistentElement["category"] {
  return value === "background" ||
    value === "surface" ||
    value === "fixture" ||
    value === "furniture" ||
    value === "landmark" ||
    value === "plant" ||
    value === "prop" ||
    value === "architecture" ||
    value === "terrain"
    ? value
    : "other";
}

function parseBbox(value: unknown): [number, number, number, number] {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 1000)
  ) {
    return value as [number, number, number, number];
  }
  return [0, 0, 1000, 1000];
}

function signaturesAreSimilar(first: SceneLocationSignature | undefined, second: SceneLocationSignature): boolean {
  if (!first) {
    return false;
  }
  if (first.environmentKind !== "unknown" && second.environmentKind !== "unknown" && first.environmentKind !== second.environmentKind) {
    return false;
  }
  if (normalizeText(first.locationType) === normalizeText(second.locationType)) {
    return true;
  }
  return countSharedObjects(first.keyObjects, second.keyObjects) >= 2;
}

function countSharedObjects(first: string[], second: string[]): number {
  const firstTokens = new Set(first.map(normalizeText));
  return second.map(normalizeText).filter((item) => firstTokens.has(item)).length;
}

function mergeSignatures(signatures: SceneLocationSignature[]): SceneLocationSignature {
  const first = signatures[0] ?? {
    locationType: "unknown location",
    environmentKind: "unknown" as const,
    keyObjects: [],
    lighting: "unspecified lighting",
    palette: [],
    mood: "natural"
  };

  return {
    locationType: first.locationType,
    environmentKind: first.environmentKind,
    keyObjects: uniqueStrings(signatures.flatMap((signature) => signature.keyObjects)).slice(0, 8),
    lighting: first.lighting,
    palette: uniqueStrings(signatures.flatMap((signature) => signature.palette)).slice(0, 6),
    mood: first.mood,
    persistentElements: mergePersistentElements(signatures.flatMap((signature) => signature.persistentElements ?? [])),
    surfacePatterns: mergeSurfacePatterns(signatures.flatMap((signature) => signature.surfacePatterns ?? [])),
    layoutLocks: uniqueStrings(signatures.flatMap((signature) => signature.layoutLocks ?? [])).slice(0, 8),
    forbiddenSceneChanges: uniqueStrings(signatures.flatMap((signature) => signature.forbiddenSceneChanges ?? [])).slice(0, 12)
  };
}

function createLockedSceneJson(signature: SceneLocationSignature): Record<string, unknown> {
  const objects = signature.keyObjects.length > 0 ? signature.keyObjects.join(", ") : "stable background objects";
  const palette = signature.palette.length > 0 ? signature.palette : ["natural tones", "neutral light", "realistic colors"];
  const persistentElements = signature.persistentElements?.length
    ? signature.persistentElements
    : signature.keyObjects.map((objectName) => ({
      name: objectName,
      category: "other" as const,
      bbox: [0, 0, 1000, 1000] as [number, number, number, number],
      position: "stable location in the frame",
      visualDetails: [],
      mustPreserve: [`Preserve ${objectName}.`]
    }));
  const surfacePatterns = signature.surfacePatterns ?? [];
  const forbiddenSceneChanges = [
    ...createGenericForbiddenSceneChanges(signature),
    ...(signature.forbiddenSceneChanges ?? []),
    ...surfacePatterns.flatMap((pattern) => pattern.forbiddenAlternatives.map((alternative) => `Do not replace ${pattern.surface} with ${alternative}.`))
  ];
  return {
    high_level_description: `A photorealistic Instagram lifestyle photoshoot in the same ${signature.locationType}.`,
    style_description: {
      aesthetics: signature.mood,
      lighting: signature.lighting,
      photo: "realistic vertical editorial photography",
      medium: "photograph",
      color_palette: palette
    },
    scene_consistency: {
      environment_kind: signature.environmentKind,
      location_type: signature.locationType,
      layout_locks: [
        `Keep the same ${signature.locationType} environment.`,
        ...(signature.layoutLocks ?? []),
        ...persistentElements.map((element) => `Keep ${element.name} ${element.position}.`)
      ],
      surface_patterns: surfacePatterns.map((pattern) => ({
        surface: pattern.surface,
        bbox: pattern.bbox,
        pattern_type: pattern.patternType,
        orientation: pattern.orientation,
        scale: pattern.scale,
        colors: pattern.colors,
        forbidden_alternatives: pattern.forbiddenAlternatives
      })),
      forbidden_scene_changes: uniqueStrings(forbiddenSceneChanges)
    },
    compositional_deconstruction: {
      background: `The same ${signature.locationType} with ${objects}. Keep the environment, lighting, color palette, and major objects consistent across every generated image.`,
      elements: persistentElements.map((element) => ({
        type: "obj",
        bbox: element.bbox,
        desc: [
          element.name,
          element.position,
          ...element.visualDetails,
          ...element.mustPreserve
        ].filter(Boolean).join("; ")
      }))
    }
  };
}

function mergePersistentElements(elements: ScenePersistentElement[]): ScenePersistentElement[] {
  const byName = new Map<string, ScenePersistentElement>();
  for (const element of elements) {
    const key = normalizeText(element.name);
    if (!key || byName.has(key)) {
      continue;
    }
    byName.set(key, element);
  }
  return [...byName.values()].slice(0, 10);
}

function mergeSurfacePatterns(patterns: SceneSurfacePattern[]): SceneSurfacePattern[] {
  const bySurface = new Map<string, SceneSurfacePattern>();
  for (const pattern of patterns) {
    const key = normalizeText(pattern.surface);
    if (!key || bySurface.has(key)) {
      continue;
    }
    bySurface.set(key, pattern);
  }
  return [...bySurface.values()].slice(0, 6);
}

function createGenericForbiddenSceneChanges(signature: SceneLocationSignature): string[] {
  return [
    `Do not change the scene into a different ${signature.environmentKind} environment.`,
    `Do not replace the ${signature.locationType} with a different location type.`,
    "Do not introduce a new dominant background that is not present in the locked scene.",
    "Do not change the dominant surface pattern orientation, scale, or material.",
    "Do not move the main stable background anchors to unrelated parts of the frame."
  ];
}

function createSceneName(signature: SceneLocationSignature, index: number): string {
  const name = signature.locationType
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return name || `Scene ${index + 1}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result = [];
  for (const value of values) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
}

function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, "_").slice(0, 48) || "location";
}

function resolveInputPath(inputDir: string, publicPath: string): string {
  if (!publicPath.startsWith("/input/")) {
    throw new Error(`Only local /input media can be used for scene analysis: ${publicPath}`);
  }

  const absoluteInputDir = resolve(inputDir);
  const absolutePath = resolve(join(absoluteInputDir, publicPath.slice("/input/".length)));
  const rel = relative(absoluteInputDir, absolutePath);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Invalid input media path: ${publicPath}`);
  }

  return absolutePath;
}
