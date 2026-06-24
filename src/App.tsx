import { useEffect, useMemo, useState } from "react";
import { importInstagramUrl, listImports, openImportsFolder } from "./lib/api";
import type { ImportAsset, ImportItem } from "./lib/importTypes";
import { validateInstagramUrl } from "./lib/instagramUrl";
import { createStatusLogText } from "./lib/statusLog";

type StatusTone = "idle" | "running" | "error" | "ready";

type StatusState = {
  tone: StatusTone;
  message: string;
};

export default function App() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "Ready" });
  const [isImporting, setIsImporting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const galleryAssets = useMemo(() => flattenImportAssets(items), [items]);
  const selectedAsset = useMemo(
    () => galleryAssets.find((asset) => asset.id === selectedAssetId) ?? galleryAssets[0],
    [galleryAssets, selectedAssetId]
  );

  useEffect(() => {
    listImports()
      .then((loadedItems) => {
        setItems(loadedItems);
        setSelectedAssetId(flattenImportAssets(loadedItems)[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        setStatus({ tone: "error", message: toErrorMessage(error) });
      });
  }, []);

  async function handleImport() {
    const validation = validateInstagramUrl(url);
    if (!validation.ok) {
      setStatus({ tone: "error", message: validation.message });
      return;
    }

    setIsImporting(true);
    setStatus({ tone: "running", message: "Importing with yt-dlp. This can take a minute." });

    try {
      const imported = await importInstagramUrl(validation.url);
      setItems((current) => [imported, ...current.filter((item) => item.id !== imported.id)]);
      const importedAssets = flattenImportAssets([imported]);
      setSelectedAssetId(importedAssets[0]?.id ?? null);
      setStatus({
        tone: "ready",
        message: importedAssets.length > 1
          ? `Import complete: ${importedAssets.length} materials added.`
          : "Import complete."
      });
      setUrl("");
    } catch (error) {
      setStatus({ tone: "error", message: toErrorMessage(error) });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleOpenFolder() {
    try {
      await openImportsFolder();
      setStatus({ tone: "ready", message: "Opened imports folder." });
    } catch (error) {
      setStatus({ tone: "error", message: toErrorMessage(error) });
    }
  }

  async function handleCopyStatusLog() {
    try {
      await navigator.clipboard.writeText(createStatusLogText(status.tone, status.message));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <input
          className="url-input"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !isImporting) {
              void handleImport();
            }
          }}
          placeholder="https://www.instagram.com/reel/..."
          value={url}
        />
        <button className="primary-button" disabled={isImporting} onClick={handleImport} type="button">
          {isImporting ? "Importing" : "Import"}
        </button>
        <button className="secondary-button" onClick={handleOpenFolder} type="button">Open Folder</button>
      </section>

      <section className="workspace">
        <section className="preview-panel">
          <div className="panel-label">Preview</div>
          <Preview selected={selectedAsset} />
        </section>

        <aside className="generation-panel">
          <div className="panel-label">Generation workspace</div>
          <button disabled type="button">Image generation</button>
          <button disabled type="button">Video generation</button>
          <button disabled type="button">Trend analysis</button>
          <button disabled type="button">Caption and hashtags</button>
        </aside>
      </section>

      <section className="bottom-gallery">
        <div className={`import-log status-${status.tone}`}>
          <div className="import-log-header">
            <span>{status.tone}</span>
            <button className="copy-log-button" onClick={handleCopyStatusLog} type="button">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : "Copy"}
            </button>
          </div>
          <div className="import-log-message">{status.message}</div>
        </div>
        <div className="gallery-strip">
          {items.length === 0 ? (
            <span>Imported materials will appear here.</span>
          ) : (
            galleryAssets.map((asset) => (
              <button
                className={`gallery-item ${asset.id === selectedAsset?.id ? "selected" : ""}`}
                key={asset.id}
                onClick={() => setSelectedAssetId(asset.id)}
                type="button"
              >
                <GalleryThumb asset={asset.asset} />
                <span>{asset.asset.mediaType}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

type GalleryAsset = {
  id: string;
  importItem: ImportItem;
  asset: ImportAsset;
};

function Preview({ selected }: { selected?: GalleryAsset }) {
  if (!selected) {
    return <div className="preview-empty">Import an Instagram post or reel to preview media here.</div>;
  }

  const { asset, importItem } = selected;
  const imageSource = asset.files.image ?? asset.files.firstFrame ?? asset.files.thumbnail;

  return (
    <div className="preview-content">
      <div className="media-stage">
        {asset.files.video ? (
          <video controls poster={asset.files.firstFrame ?? asset.files.thumbnail} src={asset.files.video} />
        ) : imageSource ? (
          <img alt={importItem.title ?? "Imported Instagram media"} src={imageSource} />
        ) : (
          <div className="preview-empty">No preview file was generated for this import.</div>
        )}
      </div>
      <dl className="metadata-grid">
        <div>
          <dt>Type</dt>
          <dd>{asset.mediaType}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{importItem.status}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{new Date(importItem.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd><a href={importItem.sourceUrl} rel="noreferrer" target="_blank">Open Instagram link</a></dd>
        </div>
      </dl>
    </div>
  );
}

function GalleryThumb({ asset }: { asset: ImportAsset }) {
  const source = asset.files.firstFrame ?? asset.files.image ?? asset.files.thumbnail;

  if (source) {
    return <img alt="" src={source} />;
  }

  return <span className="gallery-fallback">{asset.mediaType.slice(0, 1).toUpperCase()}</span>;
}

function flattenImportAssets(items: ImportItem[]): GalleryAsset[] {
  return items.flatMap((item) => {
    const assets = item.assets.length > 0
      ? item.assets
      : [{ id: "media", mediaType: item.mediaType === "video" ? "video" : "image", files: item.files } satisfies ImportAsset];

    return assets.map((asset) => ({
      id: `${item.id}:${asset.id}`,
      importItem: item,
      asset
    }));
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
