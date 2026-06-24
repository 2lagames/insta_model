# Instagram Import Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first interactive Studio Workspace MVP for importing Instagram media by URL, previewing downloaded media, and browsing imported assets.

**Architecture:** Use React + Vite for the browser-visible development UI. Use a local Node/Express API for the first runnable slice because Rust is not installed in the current environment; the API boundaries mirror future Tauri commands so the wrapper can replace the Node bridge later. Store imported media under `data/imports/` with an `index.json` manifest.

**Tech Stack:** React, TypeScript, Vite, Vitest, Express, Node child_process, yt-dlp, ffmpeg.

---

### Task 1: Scaffold Web App

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/App.css`
- Create: `src/vite-env.d.ts`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`

- [ ] **Step 1: Create package scripts and dependencies**

Create a Vite React project configured for TypeScript, Vitest, and a local API server. Scripts:

```json
{
  "scripts": {
    "dev": "concurrently -k \"npm:dev:web\" \"npm:dev:api\"",
    "dev:web": "vite",
    "dev:api": "tsx server/index.ts",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Add the initial React shell**

Create `src/App.tsx` with the Studio Workspace layout: URL input, Import button, Open Folder button, central preview, right-side future generation panel, bottom gallery.

- [ ] **Step 3: Verify scaffold**

Run: `npm install`

Expected: dependencies install successfully.

Run: `npm run build`

Expected: TypeScript and Vite build complete.

### Task 2: Domain Model And URL Validation

**Files:**
- Create: `src/lib/importTypes.ts`
- Create: `src/lib/instagramUrl.ts`
- Create: `src/lib/instagramUrl.test.ts`

- [ ] **Step 1: Write failing URL validation tests**

Tests must verify:

```ts
expect(validateInstagramUrl("https://www.instagram.com/p/abc123/").ok).toBe(true);
expect(validateInstagramUrl("https://www.instagram.com/reel/abc123/").ok).toBe(true);
expect(validateInstagramUrl("")).toEqual({ ok: false, message: "Paste an Instagram post or reel URL." });
expect(validateInstagramUrl("https://example.com/p/abc123/").ok).toBe(false);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/lib/instagramUrl.test.ts`

Expected: fails because `validateInstagramUrl` does not exist.

- [ ] **Step 3: Implement validation and types**

Create shared types for `ImportItem`, `ImportStatus`, `MediaKind`, and validation results. Implement `validateInstagramUrl`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- src/lib/instagramUrl.test.ts`

Expected: all URL validation tests pass.

### Task 3: Local Import API

**Files:**
- Create: `server/index.ts`
- Create: `server/importStore.ts`
- Create: `server/importStore.test.ts`
- Create: `server/instagramImporter.ts`
- Create: `server/instagramImporter.test.ts`

- [ ] **Step 1: Write failing store tests**

Tests must verify:

```ts
const store = new ImportStore(tempDir);
await store.saveItem(sampleItem);
await expect(store.listItems()).resolves.toEqual([sampleItem]);
```

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm test -- server/importStore.test.ts`

Expected: fails because `ImportStore` does not exist.

- [ ] **Step 3: Implement JSON index store**

Implement `ImportStore` with `listItems()` and `saveItem(item)` using `data/imports/index.json`.

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `npm test -- server/importStore.test.ts`

Expected: store tests pass.

- [ ] **Step 5: Write failing importer classification tests**

Tests must verify classification from yt-dlp metadata:

```ts
expect(classifyYtDlpInfo({ ext: "jpg", vcodec: "none" })).toBe("image");
expect(classifyYtDlpInfo({ ext: "mp4", vcodec: "h264" })).toBe("video");
```

- [ ] **Step 6: Implement importer helpers**

Implement helpers to create import IDs, classify metadata, locate downloaded media files, run `yt-dlp`, and run `ffmpeg` for first-frame extraction.

- [ ] **Step 7: Add API endpoints**

Expose:

```text
GET /api/imports
POST /api/imports { url }
POST /api/open-imports-folder
```

### Task 4: Connect UI To API

**Files:**
- Create: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Create API client**

Implement:

```ts
listImports(): Promise<ImportItem[]>
importInstagramUrl(url: string): Promise<ImportItem>
openImportsFolder(): Promise<void>
```

- [ ] **Step 2: Wire import flow**

The UI should:

- validate the URL before calling the API;
- show a running status while import is active;
- append the returned item to the gallery;
- select the returned item for preview;
- show structured errors in the status area.

- [ ] **Step 3: Wire gallery and preview**

Clicking an item in the bottom gallery changes the central preview. Images render with `<img>`, videos render with `<video controls>`, first frames render as image assets.

### Task 5: Verification

**Files:**
- Modify as needed: implementation files above.

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: TypeScript and Vite build complete.

- [ ] **Step 3: Start development app**

Run: `npm run dev`

Expected:

- Vite serves UI on a localhost URL;
- API serves on `http://localhost:4317`;
- app can load an empty import list;
- if a real Instagram URL is pasted, the API attempts `yt-dlp`.

- [ ] **Step 4: Document current Tauri status**

Update `plan.md` with the fact that the first runnable slice is browser + local API, and Tauri packaging is blocked until Rust toolchain is installed.

