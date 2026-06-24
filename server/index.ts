import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { validateInstagramUrl } from "../src/lib/instagramUrl";
import { ImportStore } from "./importStore";
import { importInstagramUrl } from "./instagramImporter";

const port = Number(process.env.API_PORT ?? 4317);
const projectRoot = process.cwd();
const dataDir = join(projectRoot, "data");
const importsDir = join(dataDir, "imports");
const store = new ImportStore(dataDir);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/media", express.static(dataDir));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/imports", async (_request, response) => {
  try {
    response.json({ items: await store.listItems() });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/imports", async (request, response) => {
  const url = String(request.body?.url ?? "");
  const validation = validateInstagramUrl(url);

  if (!validation.ok) {
    response.status(400).json({ error: validation.message });
    return;
  }

  try {
    const item = await importInstagramUrl(validation.url, { dataDir });
    await store.saveItem(item);
    response.json({ item });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/open-imports-folder", async (_request, response) => {
  try {
    await mkdir(importsDir, { recursive: true });
    spawn("open", [importsDir], { detached: true, stdio: "ignore" }).unref();
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: toErrorMessage(error) });
  }
});

app.listen(port, () => {
  console.log(`Import API listening on http://localhost:${port}`);
});

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
