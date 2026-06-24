import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { ImportFiles, ImportItem, MediaKind } from "../src/lib/importTypes";

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

  const outputTemplate = join(importDir, "media.%(ext)s");
  await runCommand("yt-dlp", [
    "--no-playlist",
    "--write-info-json",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "-o",
    outputTemplate,
    sourceUrl
  ]);

  const info = await readYtDlpInfo(importDir);
  const mediaType = classifyYtDlpInfo(info);
  const files = await collectImportFiles(importDir, options.publicBasePath ?? "/media");

  if (mediaType === "video" && files.video) {
    const firstFramePath = join(importDir, "first_frame.jpg");
    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      "00:00:00.5",
      "-i",
      join(options.dataDir, "..", files.video.replace(/^\/media\//, "data/")),
      "-frames:v",
      "1",
      firstFramePath
    ]);
    files.firstFrame = toPublicPath(firstFramePath, options.dataDir, options.publicBasePath ?? "/media");
  }

  const item: ImportItem = {
    id: importId,
    sourceUrl,
    mediaType,
    status: "ready",
    createdAt: new Date().toISOString(),
    title: info.title,
    files
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

async function collectImportFiles(importDir: string, publicBasePath: string): Promise<ImportFiles> {
  const files = await readdir(importDir);
  const result: ImportFiles = {};

  for (const file of files) {
    const absolute = join(importDir, file);
    const ext = extname(file).toLowerCase();

    if (file.endsWith(".info.json")) {
      result.metadata = toPublicPath(absolute, join(importDir, "..", ".."), publicBasePath);
    } else if (file === "first_frame.jpg") {
      result.firstFrame = toPublicPath(absolute, join(importDir, "..", ".."), publicBasePath);
    } else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      result.thumbnail = toPublicPath(absolute, join(importDir, "..", ".."), publicBasePath);
      if (basename(file).startsWith("media.")) {
        result.image = result.thumbnail;
      }
    } else if ([".mp4", ".mov", ".m4v", ".webm"].includes(ext)) {
      result.video = toPublicPath(absolute, join(importDir, "..", ".."), publicBasePath);
    }
  }

  return result;
}

function toPublicPath(absolutePath: string, dataDir: string, publicBasePath: string): string {
  const rel = relative(dataDir, absolutePath).split("/").join("/");
  return `${publicBasePath}/${rel}`;
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
