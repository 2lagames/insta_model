import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStateStore<T> {
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly backupPath: string;

  constructor(
    private readonly filePath: string,
    private readonly createDefault: () => T,
    private readonly parse: (value: unknown) => T
  ) {
    this.backupPath = `${filePath}.bak`;
  }

  async read(): Promise<T> {
    return await this.exclusive(async () => await this.readInternal());
  }

  async write(value: T): Promise<T> {
    const parsed = this.parse(value);
    return await this.exclusive(async () => {
      await this.writeInternal(parsed);
      return parsed;
    });
  }

  async mutate(update: (current: T) => T | Promise<T>): Promise<T> {
    return await this.exclusive(async () => {
      const current = await this.readInternal();
      const next = this.parse(await update(current));
      await this.writeInternal(next);
      return next;
    });
  }

  private async readInternal(): Promise<T> {
    try {
      return this.parse(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return this.parse(this.createDefault());
      }
      try {
        const recovered = this.parse(JSON.parse(await readFile(this.backupPath, "utf8")) as unknown);
        await this.replacePrimary(recovered);
        return recovered;
      } catch {
        throw error;
      }
    }
  }

  private async writeInternal(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.parse(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
      await copyFile(this.filePath, this.backupPath);
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        // Invalid primary state must not replace a known-good backup.
      }
    }
    await this.replacePrimary(value);
  }

  private async replacePrimary(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.filePath);
      const directoryHandle = await open(dirname(this.filePath), "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return await result;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
