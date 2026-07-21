import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { ImportAsset, ImportFiles, ImportItem, MediaKind } from "../src/lib/importTypes";
import { canonicalizeInstagramUrl, getInstagramSourceKind } from "../src/lib/instagramUrl";

const apifyInstagramScraperActorId = "apify~instagram-scraper";
const apifyApiBaseUrl = "https://api.apify.com/v2";

type FetchLike = typeof fetch;
type ApifyPost = Record<string, unknown>;

export type ImportInstagramOptions = {
  dataDir: string;
  inputDir: string;
  publicBasePath?: string;
  apifyApiToken: string;
  fetchImpl?: FetchLike;
  generateFirstFrame?: (videoPath: string, firstFramePath: string) => Promise<void>;
};

export type MaterializeImportAssetsOptions = {
  inputDir: string;
  importId: string;
  createdAt: string;
  outputDir?: string;
  publicOutputDir?: string;
  publicBasePath?: string;
  fetchImpl?: FetchLike;
  generateFirstFrame?: (videoPath: string, firstFramePath: string) => Promise<void>;
};

export function buildApifyInstagramScraperUrl(): URL {
  return new URL(`${apifyApiBaseUrl}/acts/${apifyInstagramScraperActorId}/run-sync-get-dataset-items`);
}

export async function importInstagramUrl(
  sourceUrl: string,
  options: ImportInstagramOptions
): Promise<ImportItem> {
  const canonicalSourceUrl = canonicalizeInstagramUrl(sourceUrl);
  const apiToken = options.apifyApiToken.trim();
  if (!apiToken) {
    throw new Error("Apify API token is missing. Open Настройки and save the token first.");
  }

  const importId = createImportId();
  const createdAt = new Date().toISOString();
  const dateFolder = formatDateFolder(createdAt);
  const importDir = join(options.dataDir, "imports", importId);
  const inputOutputDir = join(options.inputDir, dateFolder, importId);
  const stagingRoot = join(options.dataDir, ".staging", importId);
  const stagingInputDir = join(stagingRoot, "media");
  const stagingImportDir = join(stagingRoot, "import");
  let publishedInput = false;
  let publishedImport = false;

  try {
    const responsePayload = await fetchApifyInstagramPosts(canonicalSourceUrl, apiToken, options.fetchImpl ?? fetch);
    const item = createImportItemFromApifyPosts(canonicalSourceUrl, responsePayload, createdAt, importId);
    item.assets = await materializeImportAssets(item.assets, {
      inputDir: options.inputDir,
      importId,
      createdAt,
      outputDir: stagingInputDir,
      publicOutputDir: inputOutputDir,
      fetchImpl: options.fetchImpl,
      generateFirstFrame: options.generateFirstFrame
    });

    await mkdir(stagingImportDir, { recursive: true });
    await writeFile(
      join(stagingImportDir, "apify-media.json"),
      JSON.stringify({ sourceUrl: canonicalSourceUrl, assets: item.assets }, null, 2),
      "utf8"
    );
    await writeFile(
      join(stagingImportDir, "source.json"),
      JSON.stringify({ sourceUrl: canonicalSourceUrl, originalUrl: sourceUrl, provider: "apify" }, null, 2),
      "utf8"
    );

    await mkdir(join(options.inputDir, dateFolder), { recursive: true });
    await mkdir(join(options.dataDir, "imports"), { recursive: true });
    await rename(stagingInputDir, inputOutputDir);
    publishedInput = true;
    await rename(stagingImportDir, importDir);
    publishedImport = true;

    const metadataPath = toPublicPath(
      join(importDir, "apify-media.json"),
      options.dataDir,
      options.publicBasePath ?? "/media"
    );
    item.files.metadata = metadataPath;
    item.assets = item.assets.map((asset) => ({
      ...asset,
      files: { ...asset.files, metadata: metadataPath }
    }));
    item.files = item.assets[0]?.files ?? item.files;

    return item;
  } catch (error) {
    await Promise.all([
      rm(stagingRoot, { recursive: true, force: true }),
      publishedInput ? rm(inputOutputDir, { recursive: true, force: true }) : Promise.resolve(),
      publishedImport ? rm(importDir, { recursive: true, force: true }) : Promise.resolve()
    ]);
    throw error;
  }
}

export function createImportItemFromApifyPosts(
  sourceUrl: string,
  posts: unknown,
  createdAt: string,
  importId = createImportId()
): ImportItem {
  if (!Array.isArray(posts)) {
    throw new Error("Apify returned an invalid Instagram result set.");
  }

  const post = posts.find((candidate): candidate is ApifyPost => isRecord(candidate));
  if (!post) {
    throw new Error("Apify did not return a public Instagram post for this link.");
  }

  const shortcode = getString(post, "shortCode") ?? "instagram-post";
  const videoUrl = getString(post, "type")?.toLowerCase() === "video" ? selectVideoUrl(post) : undefined;
  const imageUrls = videoUrl ? [] : collectPhotoUrls(post);
  if (!videoUrl && imageUrls.length === 0) {
    throw new Error("Apify did not include a downloadable photo or video for this link.");
  }

  const assets: ImportAsset[] = videoUrl
    ? [{ id: `${shortcode}-video-001`, mediaType: "video", files: { video: videoUrl } }]
    : imageUrls.map((imageUrl, index) => ({
      id: `${shortcode}-image-${String(index + 1).padStart(3, "0")}`,
      mediaType: "image",
      files: { image: imageUrl, thumbnail: imageUrl }
    }));
  const mediaType: MediaKind = videoUrl ? "video" : assets.length > 1 ? "carousel" : "image";

  return {
    id: importId,
    sourceUrl,
    sourceKind: getInstagramSourceKind(sourceUrl),
    mediaType,
    status: "ready",
    createdAt,
    provider: "apify",
    files: assets[0]?.files ?? {},
    assets
  };
}

export async function materializeImportAssets(
  assets: ImportAsset[],
  options: MaterializeImportAssetsOptions
): Promise<ImportAsset[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const publicBasePath = options.publicBasePath ?? "/input";
  const dateFolder = formatDateFolder(options.createdAt);
  const outputDir = options.outputDir ?? join(options.inputDir, dateFolder, options.importId);
  const publicOutputDir = options.publicOutputDir ?? outputDir;
  await mkdir(outputDir, { recursive: true });

  return await Promise.all(assets.map(async (asset, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    if (asset.mediaType === "image" && asset.files.image) {
      const imageFileName = `image-${ordinal}${inferExtension(asset.files.image, "image")}`;
      await downloadToFile(asset.files.image, join(outputDir, imageFileName), fetchImpl);
      const publicImagePath = toPublicPath(join(publicOutputDir, imageFileName), options.inputDir, publicBasePath);
      const files: ImportFiles = { ...asset.files, image: publicImagePath, thumbnail: publicImagePath };
      return { ...asset, files };
    }

    if (asset.mediaType === "video" && asset.files.video) {
      const videoFileName = `video-${ordinal}${inferExtension(asset.files.video, "video")}`;
      const videoPath = join(outputDir, videoFileName);
      await downloadToFile(asset.files.video, videoPath, fetchImpl);
      const firstFrameFileName = `first-frame-${ordinal}.jpg`;
      await (options.generateFirstFrame ?? generateFirstFrameWithFfmpeg)(videoPath, join(outputDir, firstFrameFileName));
      const publicVideoPath = toPublicPath(join(publicOutputDir, videoFileName), options.inputDir, publicBasePath);
      const publicFirstFramePath = toPublicPath(join(publicOutputDir, firstFrameFileName), options.inputDir, publicBasePath);
      const files: ImportFiles = {
        ...asset.files,
        video: publicVideoPath,
        firstFrame: publicFirstFramePath,
        thumbnail: publicFirstFramePath
      };
      return { ...asset, files };
    }

    throw new Error("Apify returned an asset without a downloadable media URL.");
  }));
}

async function fetchApifyInstagramPosts(
  sourceUrl: string,
  apiToken: string,
  fetchImpl: FetchLike
): Promise<unknown[]> {
  const response = await fetchImpl(buildApifyInstagramScraperUrl(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      directUrls: [sourceUrl],
      resultsType: getInstagramSourceKind(sourceUrl) === "reel" ? "reels" : "posts",
      resultsLimit: 1
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error("Apify rejected the API token. Open Настройки, save a valid token, and try again.");
    }
    if (response.status === 402) {
      throw new Error("Apify has no available prepaid usage for this import. Check your Apify billing and monthly limit.");
    }
    throw new Error(`Apify Instagram Scraper failed with ${response.status}: ${body || response.statusText}`);
  }

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Apify returned an invalid Instagram result set.");
  }
  return payload;
}

function collectPhotoUrls(post: ApifyPost): string[] {
  if (getString(post, "type")?.toLowerCase() === "video") {
    return [];
  }

  const directImages = getUrlArray(post, "carouselImages");
  if (directImages.length > 0) {
    return uniqueUrls(directImages);
  }

  const imageUrls = getUrlArray(post, "images");
  if (imageUrls.length > 0) {
    return uniqueUrls(imageUrls);
  }

  const childImages = getRecordArray(post, "childPosts").flatMap((child) => {
    if (getString(child, "type")?.toLowerCase() === "video") {
      return [];
    }
    const images = getUrlArray(child, "carouselImages");
    if (images.length > 0) {
      return images;
    }
    const displayImages = getUrlArray(child, "images");
    return displayImages.length > 0 ? displayImages : [getString(child, "displayUrl")];
  });
  if (childImages.length > 0) {
    return uniqueUrls(childImages);
  }

  return uniqueUrls([getString(post, "displayUrl")]);
}

function selectVideoUrl(post: ApifyPost): string | undefined {
  return uniqueUrls([getString(post, "videoUrl"), getString(post, "video_url")])[0];
}

function getUrlArray(record: ApifyPost, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string" && isHttpUrl(candidate))
    : [];
}

function getRecordArray(record: ApifyPost, key: string): ApifyPost[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((candidate): candidate is ApifyPost => isRecord(candidate)) : [];
}

function uniqueUrls(candidates: Array<string | undefined>): string[] {
  return [...new Set(candidates.filter((candidate): candidate is string => typeof candidate === "string" && isHttpUrl(candidate)))];
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function getString(record: ApifyPost, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function downloadToFile(url: string, path: string, fetchImpl: FetchLike): Promise<void> {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Could not download media ${url}: ${response.status} ${response.statusText}`);
  }

  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function inferExtension(url: string, mediaType: "image" | "video"): string {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    if (extension && /^[.][a-z0-9]+$/.test(extension)) {
      return extension;
    }
  } catch {
    // Fall through to the image default.
  }
  return mediaType === "video" ? ".mp4" : ".jpg";
}

export async function generateFirstFrameWithFfmpeg(videoPath: string, firstFramePath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide an ffmpeg binary for this platform.");
  }

  await runCommand(ffmpegPath, ["-y", "-ss", "00:00:00.1", "-i", videoPath, "-frames:v", "1", firstFramePath]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function formatDateFolder(value: string): string {
  return new Date(value).toISOString().slice(0, 10).replace(/-/g, "");
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
