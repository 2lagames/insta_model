import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { ImportAsset, ImportFiles, ImportItem, MediaKind } from "../src/lib/importTypes";

type YtDlpInfo = {
  id?: string;
  title?: string;
  ext?: string;
  vcodec?: string;
  thumbnail?: string;
  entries?: unknown[];
  requested_downloads?: Array<{ filepath?: string }>;
};

export type ImportInstagramOptions = {
  dataDir: string;
  publicBasePath?: string;
};

export function classifyYtDlpInfo(info: Partial<YtDlpInfo>): MediaKind {
  if (Array.isArray(info.entries) && info.entries.length > 1) {
    return "carousel";
  }

  const ext = info.ext?.toLowerCase();
  const vcodec = info.vcodec?.toLowerCase();

  if (vcodec && vcodec !== "none") {
    return "video";
  }

  if (ext && ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    return "image";
  }

  if (ext && ["mp4", "mov", "m4v", "webm"].includes(ext)) {
    return "video";
  }

  return "unknown";
}

export async function importInstagramUrl(
  sourceUrl: string,
  options: ImportInstagramOptions
): Promise<ImportItem> {
  const importId = createImportId();
  const importDir = join(options.dataDir, "imports", importId);
  await mkdir(importDir, { recursive: true });

  const outputTemplate = join(importDir, "media-%(autonumber)03d.%(ext)s");
  await runCommand("yt-dlp", [
    "--write-info-json",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "-o",
    outputTemplate,
    sourceUrl
  ]);

  const info = await readYtDlpInfo(importDir);
  const publicBasePath = options.publicBasePath ?? "/media";
  const assets = await collectImportAssets(importDir, options.dataDir, publicBasePath);

  for (const asset of assets) {
    if (asset.mediaType === "video" && asset.absoluteVideoPath) {
      const firstFramePath = join(importDir, `first-frame-${asset.id}.jpg`);
      await runCommand("ffmpeg", [
        "-y",
        "-ss",
        "00:00:00.5",
        "-i",
        asset.absoluteVideoPath,
        "-frames:v",
        "1",
        firstFramePath
      ]);
      asset.files.firstFrame = toPublicPath(firstFramePath, options.dataDir, publicBasePath);
    }
  }

  const publicAssets = assets.map(({ absoluteVideoPath: _absoluteVideoPath, ...asset }) => asset);
  const mediaType = publicAssets.length > 1 ? "carousel" : publicAssets[0]?.mediaType ?? classifyYtDlpInfo(info);
  const files = publicAssets[0]?.files ?? {};

  const item: ImportItem = {
    id: importId,
    sourceUrl,
    mediaType,
    status: "ready",
    createdAt: new Date().toISOString(),
    title: info.title,
    files,
    assets: publicAssets
  };

  await writeFile(join(importDir, "source.json"), JSON.stringify({ sourceUrl }, null, 2), "utf8");
  return item;
}

async function readYtDlpInfo(importDir: string): Promise<YtDlpInfo> {
  const files = await readdir(importDir);
  const infoFile = files.find((file) => file.endsWith(".info.json"));
  if (!infoFile) {
    throw new Error("yt-dlp did not produce an info JSON file.");
  }

  const raw = await readFile(join(importDir, infoFile), "utf8");
  return JSON.parse(raw) as YtDlpInfo;
}

type InternalImportAsset = ImportAsset & {
  absoluteVideoPath?: string;
};

export async function collectImportAssets(
  importDir: string,
  dataDir: string,
  publicBasePath: string
): Promise<InternalImportAsset[]> {
  const files = await readdir(importDir);
  const groups = new Map<string, InternalImportAsset>();

  for (const file of files) {
    const absolute = join(importDir, file);
    const ext = extname(file).toLowerCase();
    const key = getAssetKey(file);
    const asset = getOrCreateAsset(groups, key);
    const publicPath = toPublicPath(absolute, dataDir, publicBasePath);

    if (file.endsWith(".info.json")) {
      asset.files.metadata = publicPath;
    } else if (file.startsWith("first-frame-")) {
      asset.files.firstFrame = publicPath;
    } else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      asset.mediaType = "image";
      asset.files.image = publicPath;
      asset.files.thumbnail = publicPath;
    } else if ([".mp4", ".mov", ".m4v", ".webm"].includes(ext)) {
      asset.mediaType = "video";
      asset.files.video = publicPath;
      asset.absoluteVideoPath = absolute;
    }
  }

  return Array.from(groups.values())
    .filter((asset) => asset.files.image || asset.files.video)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function toPublicPath(absolutePath: string, dataDir: string, publicBasePath: string): string {
  const rel = relative(dataDir, absolutePath).split("/").join("/");
  return `${publicBasePath}/${rel}`;
}

function getAssetKey(file: string): string {
  if (file.startsWith("first-frame-")) {
    return file.replace(/^first-frame-/, "").replace(/\.jpg$/, "");
  }

  if (file.endsWith(".info.json")) {
    return file.replace(/\.info\.json$/, "");
  }

  return file.replace(/\.[^.]+$/, "");
}

function getOrCreateAsset(groups: Map<string, InternalImportAsset>, id: string): InternalImportAsset {
  const existing = groups.get(id);
  if (existing) {
    return existing;
  }

  const asset: InternalImportAsset = {
    id,
    mediaType: "image",
    files: {}
  };
  groups.set(id, asset);
  return asset;
}

function createImportId(): string {
  const compactDate = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${compactDate}-${suffix}`;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
