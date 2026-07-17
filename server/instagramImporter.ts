import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
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
};

export type MaterializeImportAssetsOptions = {
  inputDir: string;
  importId: string;
  createdAt: string;
  outputDir?: string;
  publicOutputDir?: string;
  publicBasePath?: string;
  fetchImpl?: FetchLike;
};

export function buildApifyInstagramScraperUrl(): URL {
  return new URL(`${apifyApiBaseUrl}/acts/${apifyInstagramScraperActorId}/run-sync-get-dataset-items`);
}

export async function importInstagramUrl(
  sourceUrl: string,
  options: ImportInstagramOptions
): Promise<ImportItem> {
  const canonicalSourceUrl = canonicalizeInstagramUrl(sourceUrl);
  if (getInstagramSourceKind(canonicalSourceUrl) === "reel") {
    throw new Error("Only photo posts and photo carousels are supported. Reels are not sent to Apify.");
  }
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
      fetchImpl: options.fetchImpl
    });

    await mkdir(stagingImportDir, { recursive: true });
    await writeFile(
      join(stagingImportDir, "apify-photos.json"),
      JSON.stringify({ sourceUrl: canonicalSourceUrl, photoUrls: item.assets.map((asset) => asset.files.image) }, null, 2),
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
      join(importDir, "apify-photos.json"),
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

  const imageUrls = collectPhotoUrls(post);
  if (imageUrls.length === 0) {
    throw new Error("Apify did not include downloadable photos for this link. Only photo posts and photo carousels are supported.");
  }

  const shortcode = getString(post, "shortCode") ?? "instagram-post";
  const assets: ImportAsset[] = imageUrls.map((imageUrl, index) => ({
    id: `${shortcode}-image-${String(index + 1).padStart(3, "0")}`,
    mediaType: "image",
    files: { image: imageUrl, thumbnail: imageUrl }
  }));
  const mediaType: MediaKind = assets.length > 1 ? "carousel" : "image";

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
    if (asset.mediaType !== "image" || !asset.files.image) {
      throw new Error("Only image assets can be materialized from Apify Instagram imports.");
    }

    const ordinal = String(index + 1).padStart(3, "0");
    const imagePath = join(outputDir, `image-${ordinal}${inferExtension(asset.files.image)}`);
    await downloadToFile(asset.files.image, imagePath, fetchImpl);
    const publicImagePath = toPublicPath(
      join(publicOutputDir, `image-${ordinal}${inferExtension(asset.files.image)}`),
      options.inputDir,
      publicBasePath
    );
    const files: ImportFiles = { ...asset.files, image: publicImagePath, thumbnail: publicImagePath };
    return { ...asset, files };
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
      resultsType: "posts",
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

function inferExtension(url: string): string {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    if (extension && /^[.][a-z0-9]+$/.test(extension)) {
      return extension;
    }
  } catch {
    // Fall through to the image default.
  }
  return ".jpg";
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
