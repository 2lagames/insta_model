import type { ImportItem } from "./importTypes";

type ImportsResponse = {
  items: ImportItem[];
};

type ImportResponse = {
  item: ImportItem;
};

type ErrorResponse = {
  error?: string;
};

export async function listImports(): Promise<ImportItem[]> {
  const response = await fetch("/api/imports");
  await assertOk(response);
  const data = (await response.json()) as ImportsResponse;
  return data.items;
}

export async function importInstagramUrl(url: string): Promise<ImportItem> {
  const response = await fetch("/api/imports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });
  await assertOk(response);
  const data = (await response.json()) as ImportResponse;
  return data.item;
}

export async function openImportsFolder(): Promise<void> {
  const response = await fetch("/api/open-imports-folder", { method: "POST" });
  await assertOk(response);
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `Request failed with ${response.status}`;
  try {
    const data = (await response.json()) as ErrorResponse;
    if (data.error) {
      message = data.error;
    }
  } catch {
    // Keep the status-based fallback.
  }

  throw new Error(message);
}
