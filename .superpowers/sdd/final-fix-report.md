# Final concurrency fix

## Scope

- `src/App.tsx`
- `src/App.layout.test.ts`

## RED

Added `serializes imports, local uploads, and generation session mutations` in `src/App.layout.test.ts`.

Command: `npm test -- src/App.layout.test.ts`

Result: failed as expected because `App.tsx` did not contain `const isSessionMutationBusy = isImporting || isGeneratingPrompt || isGeneratingImages;`.

## GREEN

Added the shared `isSessionMutationBusy` flag and applied it to Instagram import controls, the Enter shortcut, local file input, reset action, generation controls, and direct action handlers. `GenerationWorkspace` receives this flag so its prompt and image buttons remain disabled during uploads/imports as well as while either generation action runs.

Command: `npm test -- src/App.layout.test.ts`

Result: passed — 13 tests.

## Build

Command: `npm run build`

Result: passed — TypeScript build and Vite production build completed successfully.
