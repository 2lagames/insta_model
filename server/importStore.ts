import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CurrentMediaSession, ImportIndex, ImportItem } from "../src/lib/importTypes";

const emptyCurrentSession: CurrentMediaSession = {
  itemIds: [],
  sceneBibles: [],
  mediaSceneMap: {}
};

export class ImportStore {
  private readonly indexPath: string;
  private readonly inputDir: string;

  constructor(private readonly rootDir: string, inputDir = join(dirname(rootDir), "input")) {
    this.indexPath = join(rootDir, "imports", "index.json");
    this.inputDir = inputDir;
  }

  async listItems(): Promise<ImportItem[]> {
    const index = await this.readIndex();
    return index.items;
  }

  async findNewestBySourceUrl(sourceUrl: string): Promise<ImportItem | undefined> {
    const index = await this.readIndex();
    return getReadyImportsForSourceUrl(index.items, sourceUrl)[0];
  }

  async findNewestReusableBySourceUrl(sourceUrl: string): Promise<ImportItem | undefined> {
    const index = await this.readIndex();
    for (const item of getReadyImportsForSourceUrl(index.items, sourceUrl)) {
      if (await this.hasReusableMedia(item)) {
        return item;
      }
    }
    return undefined;
  }

  async cleanupDuplicateInstagramImports(): Promise<{ retainedItemIds: string[]; deletedItemIds: string[] }> {
    const index = await this.readIndex();
    const importsBySourceUrl = new Map<string, ImportItem[]>();

    for (const item of index.items) {
      if (!isReadyInstagramImport(item)) {
        continue;
      }
      const items = importsBySourceUrl.get(item.sourceUrl) ?? [];
      items.push(item);
      importsBySourceUrl.set(item.sourceUrl, items);
    }

    const replacements = new Map<string, string>();
    const deletedItems: ImportItem[] = [];
    const retainedItemIds: string[] = [];

    for (const items of importsBySourceUrl.values()) {
      if (items.length < 2) {
        continue;
      }

      const orderedItems = sortNewestFirst(items);
      let retainedItem: ImportItem | undefined;
      for (const item of orderedItems) {
        if (await this.hasReusableMedia(item)) {
          retainedItem = item;
          break;
        }
      }

      if (!retainedItem) {
        continue;
      }

      retainedItemIds.push(retainedItem.id);
      for (const item of orderedItems) {
        if (item.id === retainedItem.id) {
          continue;
        }
        replacements.set(item.id, retainedItem.id);
        deletedItems.push(item);
      }
    }

    for (const item of deletedItems) {
      await this.removeItemFiles(item);
    }

    const deletedItemIds = deletedItems.map((item) => item.id);
    const deletedIdSet = new Set(deletedItemIds);
    const nextIndex: ImportIndex = {
      ...index,
      items: index.items.filter((item) => !deletedIdSet.has(item.id))
    };

    if (index.currentSession || index.currentSessionItemIds) {
      const currentSession = replaceSessionImportIds(normalizeCurrentSession(index), replacements, deletedIdSet);
      nextIndex.currentSessionItemIds = currentSession.itemIds;
      nextIndex.currentSession = currentSession;
    }

    await this.writeIndex(nextIndex);
    return { retainedItemIds, deletedItemIds };
  }

  async readCurrentSessionItemIds(): Promise<string[]> {
    const session = await this.readCurrentSession();
    return session.itemIds;
  }

  async readCurrentSession(): Promise<CurrentMediaSession> {
    const index = await this.readIndex();
    return normalizeCurrentSession(index);
  }

  async writeCurrentSession(session: CurrentMediaSession): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex({
      ...index,
      currentSessionItemIds: session.itemIds,
      currentSession: session
    });
  }

  async startCurrentSession(
    itemId: string,
    sceneData?: Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap">
  ): Promise<void> {
    const index = await this.readIndex();
    const currentSession: CurrentMediaSession = {
      itemIds: [itemId],
      sceneBibles: sceneData?.sceneBibles ?? [],
      mediaSceneMap: sceneData?.mediaSceneMap ?? {}
    };
    await this.writeIndex({
      ...index,
      currentSessionItemIds: currentSession.itemIds,
      currentSession
    });
  }

  async appendToCurrentSession(
    itemId: string,
    sceneData?: Pick<CurrentMediaSession, "sceneBibles" | "mediaSceneMap">
  ): Promise<void> {
    const index = await this.readIndex();
    const currentSession = normalizeCurrentSession(index);
    const nextSession: CurrentMediaSession = {
      itemIds: [...currentSession.itemIds.filter((existingId) => existingId !== itemId), itemId],
      sceneBibles: sceneData?.sceneBibles ?? currentSession.sceneBibles,
      mediaSceneMap: {
        ...currentSession.mediaSceneMap,
        ...(sceneData?.mediaSceneMap ?? {})
      }
    };
    await this.writeIndex({
      ...index,
      currentSessionItemIds: nextSession.itemIds,
      currentSession: nextSession
    });
  }

  async resetCurrentSession(): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex({
      ...index,
      currentSessionItemIds: [],
      currentSession: emptyCurrentSession
    });
  }

  async readIndex(): Promise<ImportIndex> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as ImportIndex;
      return {
        items: parsed.items ?? [],
        currentSessionItemIds: parsed.currentSessionItemIds,
        currentSession: parsed.currentSession
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { items: [] };
      }
      throw error;
    }
  }

  async saveItem(item: ImportItem): Promise<void> {
    const index = await this.readIndex();
    const nextItems = [item, ...index.items.filter((existing) => existing.id !== item.id)];
    await this.writeIndex({
      ...index,
      items: nextItems
    });
  }

  private async writeIndex(index: ImportIndex): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), "utf8");
  }

  private async hasReusableMedia(item: ImportItem): Promise<boolean> {
    const paths = getLocalMediaPaths(item);
    if (paths.length === 0) {
      return false;
    }

    try {
      await Promise.all(paths.map(async (path) => {
        const absolutePath = resolvePublicInputPath(this.inputDir, path);
        if (!absolutePath) {
          throw new Error(`Invalid local media path: ${path}`);
        }
        await access(absolutePath);
      }));
      return true;
    } catch {
      return false;
    }
  }

  private async removeItemFiles(item: ImportItem): Promise<void> {
    const inputDirectories = new Set<string>();
    for (const path of getLocalMediaPaths(item)) {
      const directory = getOwnedInputDirectory(this.inputDir, item.id, path);
      if (directory) {
        inputDirectories.add(directory);
      }
    }

    for (const directory of inputDirectories) {
      await rm(directory, { recursive: true, force: true });
    }

    const metadataDirectory = getOwnedMetadataDirectory(this.rootDir, item.id);
    if (metadataDirectory) {
      await rm(metadataDirectory, { recursive: true, force: true });
    }
  }
}

export function normalizeCurrentSession(index: ImportIndex): CurrentMediaSession {
  return {
    itemIds: index.currentSession?.itemIds ?? index.currentSessionItemIds ?? [],
    sceneBibles: index.currentSession?.sceneBibles ?? [],
    mediaSceneMap: index.currentSession?.mediaSceneMap ?? {}
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function getReadyImportsForSourceUrl(items: ImportItem[], sourceUrl: string): ImportItem[] {
  return sortNewestFirst(items.filter((item) => item.status === "ready" && item.sourceUrl === sourceUrl));
}

function sortNewestFirst(items: ImportItem[]): ImportItem[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isReadyInstagramImport(item: ImportItem): boolean {
  return item.status === "ready" && item.sourceUrl.startsWith("https://www.instagram.com/");
}

function getLocalMediaPaths(item: ImportItem): string[] {
  const files = item.assets.length > 0 ? item.assets.map((asset) => asset.files) : [item.files];
  return [...new Set(files.flatMap((assetFiles) => Object.values(assetFiles)
    .filter((path): path is string => typeof path === "string" && path.startsWith("/input/"))))];
}

function resolvePublicInputPath(inputDir: string, publicPath: string): string | undefined {
  if (!publicPath.startsWith("/input/")) {
    return undefined;
  }

  const absoluteInputDir = resolve(inputDir);
  const absolutePath = resolve(join(absoluteInputDir, publicPath.slice("/input/".length)));
  const pathRelativeToInput = relative(absoluteInputDir, absolutePath);
  if (!pathRelativeToInput || pathRelativeToInput.startsWith("..") || isAbsolute(pathRelativeToInput)) {
    return undefined;
  }
  return absolutePath;
}

function getOwnedInputDirectory(inputDir: string, importId: string, publicPath: string): string | undefined {
  const absolutePath = resolvePublicInputPath(inputDir, publicPath);
  if (!absolutePath) {
    return undefined;
  }

  const pathSegments = relative(resolve(inputDir), absolutePath).split(/[\\/]/);
  if (pathSegments.length < 3 || pathSegments[1] !== importId) {
    return undefined;
  }
  return resolve(join(resolve(inputDir), pathSegments[0] ?? "", pathSegments[1] ?? ""));
}

function getOwnedMetadataDirectory(rootDir: string, importId: string): string | undefined {
  const importsDir = resolve(rootDir, "imports");
  const metadataDirectory = resolve(importsDir, importId);
  return relative(importsDir, metadataDirectory) === importId ? metadataDirectory : undefined;
}

function replaceSessionImportIds(
  session: CurrentMediaSession,
  replacements: Map<string, string>,
  deletedItemIds: Set<string>
): CurrentMediaSession {
  const replaceMediaId = (mediaId: string): string => {
    for (const [deletedId, retainedId] of replacements) {
      if (mediaId.startsWith(`${deletedId}:`)) {
        return `${retainedId}${mediaId.slice(deletedId.length)}`;
      }
    }
    return mediaId;
  };
  const itemIds = [...new Set(session.itemIds
    .map((itemId) => replacements.get(itemId) ?? itemId)
    .filter((itemId) => !deletedItemIds.has(itemId)))];
  const mediaSceneMap = Object.fromEntries(Object.entries(session.mediaSceneMap)
    .map(([mediaId, sceneId]) => [replaceMediaId(mediaId), sceneId]));

  return {
    itemIds,
    sceneBibles: session.sceneBibles.map((sceneBible) => ({
      ...sceneBible,
      sourceMediaIds: sceneBible.sourceMediaIds.map(replaceMediaId)
    })),
    mediaSceneMap
  };
}
