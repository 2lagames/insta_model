import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImportIndex, ImportItem } from "../src/lib/importTypes";

export class ImportStore {
  private readonly indexPath: string;

  constructor(private readonly rootDir: string) {
    this.indexPath = join(rootDir, "imports", "index.json");
  }

  async listItems(): Promise<ImportItem[]> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as ImportIndex;
      return parsed.items ?? [];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async saveItem(item: ImportItem): Promise<void> {
    const items = await this.listItems();
    const nextItems = [item, ...items.filter((existing) => existing.id !== item.id)];
    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify({ items: nextItems }, null, 2), "utf8");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
