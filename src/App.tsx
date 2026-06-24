import { useEffect, useMemo, useState } from "react";
import { importInstagramUrl, listImports, openImportsFolder } from "./lib/api";
import type { ImportItem } from "./lib/importTypes";
import { validateInstagramUrl } from "./lib/instagramUrl";

type StatusTone = "idle" | "running" | "error" | "ready";

type StatusState = {
  tone: StatusTone;
  message: string;
};

export default function App() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "Ready" });
  const [isImporting, setIsImporting] = useState(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId]
  );

  useEffect(() => {
    listImports()
      .then((loadedItems) => {
        setItems(loadedItems);
        setSelectedId(loadedItems[0]?.id ?? null);
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
      setSelectedId(imported.id);
      setStatus({ tone: "ready", message: "Import complete." });
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
          <Preview item={selectedItem} />
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
        <div className={`import-log status-${status.tone}`}>{status.message}</div>
        <div className="gallery-strip">
          {items.length === 0 ? (
            <span>Imported materials will appear here.</span>
          ) : (
            items.map((item) => (
              <button
                className={`gallery-item ${item.id === selectedItem?.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <GalleryThumb item={item} />
                <span>{item.mediaType}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Preview({ item }: { item?: ImportItem }) {
  if (!item) {
    return <div className="preview-empty">Import an Instagram post or reel to preview media here.</div>;
  }

  const imageSource = item.files.image ?? item.files.firstFrame ?? item.files.thumbnail;

  return (
    <div className="preview-content">
      <div className="media-stage">
        {item.files.video ? (
          <video controls poster={item.files.firstFrame ?? item.files.thumbnail} src={item.files.video} />
        ) : imageSource ? (
          <img alt={item.title ?? "Imported Instagram media"} src={imageSource} />
        ) : (
          <div className="preview-empty">No preview file was generated for this import.</div>
        )}
      </div>
      <dl className="metadata-grid">
        <div>
          <dt>Type</dt>
          <dd>{item.mediaType}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{item.status}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{new Date(item.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd><a href={item.sourceUrl} rel="noreferrer" target="_blank">Open Instagram link</a></dd>
        </div>
      </dl>
    </div>
  );
}

function GalleryThumb({ item }: { item: ImportItem }) {
  const source = item.files.firstFrame ?? item.files.image ?? item.files.thumbnail;

  if (source) {
    return <img alt="" src={source} />;
  }

  return <span className="gallery-fallback">{item.mediaType.slice(0, 1).toUpperCase()}</span>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
