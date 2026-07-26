import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStateStore } from "./jsonStateStore";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function parseCounter(value: unknown): { values: number[] } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { values?: unknown }).values)) {
    throw new Error("Invalid counter state.");
  }
  const values = (value as { values: unknown[] }).values;
  if (!values.every((item) => typeof item === "number")) throw new Error("Invalid counter values.");
  return { values: values as number[] };
}

describe("JsonStateStore", () => {
  it("serializes concurrent mutations without losing values", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-state-"));
    tempDirs.push(root);
    const store = new JsonStateStore(join(root, "state.json"), () => ({ values: [] }), parseCounter);

    await Promise.all(Array.from({ length: 20 }, (_, value) =>
      store.mutate((state) => ({ values: [...state.values, value] }))
    ));

    expect((await store.read()).values.slice().sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, value) => value));
  });

  it("restores the last valid backup when the primary file is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-state-"));
    tempDirs.push(root);
    const filePath = join(root, "state.json");
    const store = new JsonStateStore(filePath, () => ({ values: [] }), parseCounter);
    await store.write({ values: [1] });
    await store.write({ values: [1, 2] });
    await writeFile(filePath, "{broken", "utf8");

    expect(await store.read()).toEqual({ values: [1] });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ values: [1] });
  });

  it("rejects invalid next state without replacing the current file", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-state-"));
    tempDirs.push(root);
    const filePath = join(root, "state.json");
    const store = new JsonStateStore(filePath, () => ({ values: [] }), parseCounter);
    await store.write({ values: [1] });

    await expect(store.write({ values: ["bad"] } as unknown as { values: number[] }))
      .rejects.toThrow("Invalid counter");
    expect(await store.read()).toEqual({ values: [1] });
  });
});
