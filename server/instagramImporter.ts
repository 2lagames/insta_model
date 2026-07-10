import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { ImportAsset, ImportFiles, ImportItem, MediaKind } from "../src/lib/importTypes";
import { canonicalizeInstagramUrl, getInstagramSourceKind } from "../src/lib/instagramUrl";

const scrapeCreatorsPostEndpoint = "https://api.scrapecreators.com/v1/instagram/post";

type FetchLike = typeof fetch;

export type ImportInstagramOptions = {
  dataDir: string;
  inputDir: string;
  publicBasePath?: string;
  scrapeCreatorsApiKey: string;
  fetchImpl?: FetchLike;
};

type ScrapeCreatorsResponse = Record<string, unknown>;
type ScrapeCreatorsErrorResponse = {
  success?: boolean;
  credits_remaining?: number;
  error?: string;
  errorStatus?: number;
  message?: string;
};

type ScrapeCreatorsMediaNode = {
  id?: string;
  shortcode?: string;
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  thumbnail_src?: string;
  display_resources?: Array<{ src?: string }>;
  owner?: { username?: string };
  edge_media_to_caption?: {
    edges?: Array<{ node?: { text?: string } }>;
  };
  edge_sidecar_to_children?: {
    edges?: Array<{ node?: ScrapeCreatorsMediaNode }>;
  };
} & Record<string, unknown>;

export type MaterializeImportAssetsOptions = {
  inputDir: string;
  importId: string;
  createdAt: string;
  outputDir?: string;
  publicOutputDir?: string;
  publicBasePath?: string;
  fetchImpl?: FetchLike;
  generateFirstFrame?: (videoPath: string, framePath: string) => Promise<void>;
};

export function buildScrapeCreatorsPostUrl(sourceUrl: string, options: { downloadMedia?: boolean } = {}): URL {
  const url = new URL(scrapeCreatorsPostEndpoint);
  url.searchParams.set("url", canonicalizeInstagramUrl(sourceUrl));
  url.searchParams.set("trim", "false");
  url.searchParams.set("download_media", options.downloadMedia === false ? "false" : "true");
  return url;
}

export async function importInstagramUrl(
  sourceUrl: string,
  options: ImportInstagramOptions
): Promise<ImportItem> {
  const canonicalSourceUrl = canonicalizeInstagramUrl(sourceUrl);
  const apiKey = options.scrapeCreatorsApiKey.trim();
  if (!apiKey) {
    throw new Error("ScrapeCreators API key is missing. Open Подключения and save the key first.");
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
    const responsePayload = await fetchScrapeCreatorsPost(canonicalSourceUrl, apiKey, options.fetchImpl ?? fetch);
    const item = createImportItemFromScrapeCreatorsPost(canonicalSourceUrl, responsePayload, createdAt, importId);
    item.assets = await materializeImportAssets(item.assets, {
      inputDir: options.inputDir,
      importId,
      createdAt,
      outputDir: stagingInputDir,
      publicOutputDir: inputOutputDir,
      fetchImpl: options.fetchImpl
    });

    await mkdir(stagingImportDir, { recursive: true });
    const stagedResponsePath = join(stagingImportDir, "scrapecreators-response.json");
    await writeFile(stagedResponsePath, JSON.stringify(responsePayload, null, 2), "utf8");
    await writeFile(
      join(stagingImportDir, "source.json"),
      JSON.stringify({ sourceUrl: canonicalSourceUrl, originalUrl: sourceUrl, provider: "scrapecreators" }, null, 2),
      "utf8"
    );

    await mkdir(join(options.inputDir, dateFolder), { recursive: true });
    await mkdir(join(options.dataDir, "imports"), { recursive: true });
    await rename(stagingInputDir, inputOutputDir);
    publishedInput = true;
    await rename(stagingImportDir, importDir);
    publishedImport = true;

    const responsePath = join(importDir, "scrapecreators-response.json");
    const metadataPath = toPublicPath(responsePath, options.dataDir, options.publicBasePath ?? "/media");
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
    const files: ImportFiles = { ...asset.files };

    if (asset.mediaType === "image" && asset.files.image) {
      const imagePath = join(outputDir, `image-${ordinal}${inferExtension(asset.files.image, "image")}`);
      await downloadToFile(asset.files.image, imagePath, fetchImpl);
      const publicImagePath = toPublicPath(
        join(publicOutputDir, `image-${ordinal}${inferExtension(asset.files.image, "image")}`),
        options.inputDir,
        publicBasePath
      );
      files.image = publicImagePath;
      files.thumbnail = publicImagePath;
    }

    if (asset.mediaType === "video" && asset.files.video) {
      const videoPath = join(outputDir, `video-${ordinal}${inferExtension(asset.files.video, "video")}`);
      await downloadToFile(asset.files.video, videoPath, fetchImpl);
      const firstFramePath = join(outputDir, `first-frame-${ordinal}.jpg`);
      await (options.generateFirstFrame ?? generateFirstFrameWithFfmpeg)(videoPath, firstFramePath);

      files.video = toPublicPath(
        join(publicOutputDir, `video-${ordinal}${inferExtension(asset.files.video, "video")}`),
        options.inputDir,
        publicBasePath
      );
      files.firstFrame = toPublicPath(join(publicOutputDir, `first-frame-${ordinal}.jpg`), options.inputDir, publicBasePath);
      files.thumbnail = files.firstFrame;
    }

    return { ...asset, files };
  }));
}

export async function checkScrapeCreatorsPostAccess(
  sourceUrl: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; sourceUrl: string }> {
  const canonicalSourceUrl = canonicalizeInstagramUrl(sourceUrl);
  if (!apiKey.trim()) {
    throw new Error("ScrapeCreators API key is missing. Open Подключения and save the key first.");
  }

  const response = await fetchImpl(buildScrapeCreatorsPostUrl(canonicalSourceUrl, { downloadMedia: false }), {
    headers: { "x-api-key": apiKey.trim() }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const parsedError = parseScrapeCreatorsError(body);
    if (response.status === 403) {
      throw new Error(formatScrapeCreatorsForbiddenError(canonicalSourceUrl, parsedError, body || response.statusText));
    }
    if (response.status === 404) {
      throw new Error([
        `ScrapeCreators could not find this Instagram media: ${canonicalSourceUrl}`,
        "Check that the post/reel is public and available in Instagram without login, age, or region gates.",
        body || response.statusText
      ].join("\n"));
    }
    throw new Error(`ScrapeCreators request failed with ${response.status}: ${body || response.statusText}`);
  }

  return { ok: true, sourceUrl: canonicalSourceUrl };
}

async function fetchScrapeCreatorsPost(
  sourceUrl: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<ScrapeCreatorsResponse> {
  const response = await fetchImpl(buildScrapeCreatorsPostUrl(sourceUrl), {
    headers: { "x-api-key": apiKey }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const parsedError = parseScrapeCreatorsError(body);
    if (response.status === 403) {
      throw new Error(formatScrapeCreatorsForbiddenError(sourceUrl, parsedError, body || response.statusText));
    }
    if (response.status === 404) {
      throw new Error([
        `ScrapeCreators could not find this Instagram media: ${canonicalizeInstagramUrl(sourceUrl)}`,
        "Check that the post/reel is public and available in Instagram, then retry.",
        body || response.statusText
      ].join("\n"));
    }
    throw new Error(`ScrapeCreators request failed with ${response.status}: ${body || response.statusText}`);
  }

  return await response.json() as ScrapeCreatorsResponse;
}

export function formatScrapeCreatorsForbiddenError(
  sourceUrl: string,
  parsedError: ScrapeCreatorsErrorResponse | undefined,
  fallbackBody: string
): string {
  const message = parsedError?.message ?? fallbackBody;
  const isAgeRestricted = /age restricted/i.test(message);

  return [
    isAgeRestricted
      ? `ScrapeCreators marked this Instagram media as age-restricted: ${canonicalizeInstagramUrl(sourceUrl)}`
      : `ScrapeCreators cannot access this Instagram media: ${canonicalizeInstagramUrl(sourceUrl)}`,
    isAgeRestricted
      ? "The reel may look public in Instagram search, but ScrapeCreators only scrapes public data that is available without age/login gates."
      : "The media may require login, be region/age restricted, or be blocked for public scraping.",
    "This cannot be fixed inside the local app while ScrapeCreators is the only import provider.",
    "Use another public link, or add a separate authenticated browser/cookies fallback provider later.",
    parsedError?.credits_remaining !== undefined ? `Credits remaining: ${parsedError.credits_remaining}` : undefined,
    "",
    fallbackBody
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function parseScrapeCreatorsError(body: string): ScrapeCreatorsErrorResponse | undefined {
  try {
    const parsed = JSON.parse(body) as ScrapeCreatorsErrorResponse;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createImportItemFromScrapeCreatorsPost(
  sourceUrl: string,
  payload: ScrapeCreatorsResponse,
  createdAt: string,
  importId = createImportId()
): ImportItem {
  const root = getPostMediaNode(payload);
  if (!root) {
    throw new Error("ScrapeCreators response did not include Instagram media data.");
  }

  const childNodes = root.edge_sidecar_to_children?.edges
    ?.map((edge) => edge.node)
    .filter((node): node is ScrapeCreatorsMediaNode => Boolean(node));
  const mediaNodes = childNodes && childNodes.length > 0 ? childNodes : [root];
  const assets = mediaNodes
    .map((node, index) => createAssetFromNode(node, index))
    .filter((asset): asset is ImportAsset => Boolean(asset));

  if (assets.length === 0) {
    throw new Error("ScrapeCreators response did not include downloadable image or video URLs.");
  }

  const mediaType: MediaKind = assets.length > 1 ? "carousel" : assets[0]?.mediaType ?? "unknown";
  const caption = extractCaption(root);
  const username = root.owner?.username;

  return {
    id: importId,
    sourceUrl,
    sourceKind: getInstagramSourceKind(sourceUrl),
    mediaType,
    status: "ready",
    createdAt,
    title: username ? `@${username}` : root.shortcode,
    caption,
    provider: "scrapecreators",
    files: assets[0]?.files ?? {},
    assets
  };
}

function getPostMediaNode(payload: ScrapeCreatorsResponse): ScrapeCreatorsMediaNode | undefined {
  const data = getRecord(payload, "data");
  return (
    getRecord(data, "xdt_shortcode_media") ??
    getRecord(data, "shortcode_media") ??
    getRecord(payload, "xdt_shortcode_media") ??
    getRecord(payload, "shortcode_media") ??
    (looksLikeMediaNode(data) ? data : undefined) ??
    (looksLikeMediaNode(payload) ? payload : undefined)
  ) as ScrapeCreatorsMediaNode | undefined;
}

function looksLikeMediaNode(value: unknown): value is ScrapeCreatorsMediaNode {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return "display_url" in record || "video_url" in record || "edge_sidecar_to_children" in record;
}

function createAssetFromNode(node: ScrapeCreatorsMediaNode, index: number): ImportAsset | undefined {
  const id = node.id ?? node.shortcode ?? `media-${String(index + 1).padStart(3, "0")}`;
  const imageUrl = selectImageUrl(node);
  const videoUrl = selectVideoUrl(node);
  const isVideo = node.is_video === true || Boolean(videoUrl);
  const files: ImportFiles = {};

  if (isVideo) {
    if (!videoUrl) {
      return undefined;
    }
    files.video = videoUrl;
    if (imageUrl) {
      files.firstFrame = imageUrl;
      files.thumbnail = imageUrl;
    }
    return { id, mediaType: "video", files };
  }

  if (!imageUrl) {
    return undefined;
  }

  files.image = imageUrl;
  files.thumbnail = imageUrl;
  return { id, mediaType: "image", files };
}

function selectVideoUrl(node: ScrapeCreatorsMediaNode): string | undefined {
  return firstUrl([
    node.video_url,
    getString(node, "videoUrl"),
    getString(node, "video_download_url"),
    getString(node, "download_video_url"),
    getString(node, "download_url")
  ], ["mp4", "mov", "m4v", "webm"]);
}

function selectImageUrl(node: ScrapeCreatorsMediaNode): string | undefined {
  const largestDisplayResource = node.display_resources?.at(-1)?.src;
  return firstUrl([
    node.display_url,
    node.thumbnail_src,
    largestDisplayResource,
    getString(node, "image_url"),
    getString(node, "imageUrl"),
    getString(node, "download_image_url"),
    getString(node, "download_url")
  ], ["jpg", "jpeg", "png", "webp"]);
}

function firstUrl(candidates: Array<string | undefined>, preferredExtensions: string[]): string | undefined {
  const urls = candidates.filter((candidate): candidate is string => {
    return typeof candidate === "string" && /^https?:\/\//i.test(candidate);
  });

  return urls.find((candidate) => hasExtension(candidate, preferredExtensions)) ?? urls[0];
}

function hasExtension(value: string, extensions: string[]): boolean {
  const pathname = new URL(value).pathname.toLowerCase();
  return extensions.some((extension) => pathname.endsWith(`.${extension}`));
}

function extractCaption(node: ScrapeCreatorsMediaNode): string | undefined {
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text?.trim();
  return caption || undefined;
}

function getRecord(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
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

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
}

function inferExtension(url: string, mediaType: "image" | "video"): string {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    if (extension && /^[.][a-z0-9]+$/.test(extension)) {
      return extension;
    }
  } catch {
    // Fall through to the media-type default.
  }

  return mediaType === "video" ? ".mp4" : ".jpg";
}

async function generateFirstFrameWithFfmpeg(videoPath: string, framePath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide an ffmpeg binary for this platform.");
  }

  await runCommand(ffmpegPath, [
    "-y",
    "-ss",
    "00:00:00.1",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    framePath
  ]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
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
