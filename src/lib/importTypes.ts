export type MediaKind = "image" | "video" | "carousel" | "unknown";

export type ImportStatus = "ready" | "failed" | "partial";

export type ImportFiles = {
  image?: string;
  video?: string;
  thumbnail?: string;
  firstFrame?: string;
  metadata?: string;
};

export type ImportItem = {
  id: string;
  sourceUrl: string;
  mediaType: MediaKind;
  status: ImportStatus;
  createdAt: string;
  title?: string;
  error?: string;
  files: ImportFiles;
};

export type ImportIndex = {
  items: ImportItem[];
};

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

