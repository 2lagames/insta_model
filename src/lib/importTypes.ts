export type MediaKind = "image" | "video" | "carousel" | "unknown";
export type InstagramSourceKind = "post" | "reel";

export type ImportStatus = "ready" | "failed" | "partial";

export type ImportFiles = {
  image?: string;
  video?: string;
  thumbnail?: string;
  firstFrame?: string;
  metadata?: string;
};

export type ImportAsset = {
  id: string;
  mediaType: Exclude<MediaKind, "carousel" | "unknown">;
  files: ImportFiles;
};

export type ImportItem = {
  id: string;
  sourceUrl: string;
  sourceKind?: InstagramSourceKind;
  mediaType: MediaKind;
  status: ImportStatus;
  createdAt: string;
  title?: string;
  caption?: string;
  provider?: "scrapecreators" | "runninghub";
  error?: string;
  files: ImportFiles;
  assets: ImportAsset[];
};

export type SceneEnvironmentKind = "interior" | "exterior" | "mixed" | "unknown";

export type SceneLocationSignature = {
  locationType: string;
  environmentKind: SceneEnvironmentKind;
  keyObjects: string[];
  lighting: string;
  palette: string[];
  mood: string;
  persistentElements?: ScenePersistentElement[];
  surfacePatterns?: SceneSurfacePattern[];
  layoutLocks?: string[];
  forbiddenSceneChanges?: string[];
};

export type ScenePersistentElement = {
  name: string;
  category: "background" | "surface" | "fixture" | "furniture" | "landmark" | "plant" | "prop" | "architecture" | "terrain" | "other";
  bbox: [number, number, number, number];
  position: string;
  visualDetails: string[];
  mustPreserve: string[];
};

export type SceneSurfacePattern = {
  surface: string;
  bbox: [number, number, number, number];
  patternType: string;
  orientation: string;
  scale: string;
  colors: string[];
  forbiddenAlternatives: string[];
};

export type SceneBible = {
  id: string;
  name: string;
  sourceMediaIds: string[];
  locationSignature: SceneLocationSignature;
  lockedJson: Record<string, unknown>;
};

export type CurrentMediaSession = {
  itemIds: string[];
  sceneBibles: SceneBible[];
  mediaSceneMap: Record<string, string>;
  promptTexts?: Record<string, string>;
};

export type ImportIndex = {
  items: ImportItem[];
  currentSessionItemIds?: string[];
  currentSession?: CurrentMediaSession;
};

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; message: string };
