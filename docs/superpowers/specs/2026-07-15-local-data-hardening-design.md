# Local Data Hardening Design

## Goal

Keep connection secrets, connection settings, imported metadata, and Generation workspace text on the local machine without exposing private storage through the application or accidentally adding it to Git.

## Storage and HTTP boundary

The existing local files remain the durable stores so no migration is required:

- `data/connections.local.json` stores API keys, connection settings, and generation-prefix options.
- `data/imports/index.json` stores the current media session and saved prompt text.
- `input/` and `output/` store local media.

The Express server must not publish `data/` as a static directory. It may serve only `data/imports/<import-id>/scrapecreators-response.json` through the existing `/media/imports/...` URL used by the metadata link. Requests for `connections.local.json`, `imports/index.json`, path traversal, or other files return 404.

On POSIX systems, every read or write of `connections.local.json` repairs its permissions to `0600`. New files are created with `0600`. Windows keeps the same code path without relying on POSIX permission semantics.

## API-key editing

The public connections response continues to expose only `has...` flags and masked previews. The raw-key GET endpoint is removed. Opening a key editor always presents an empty password field used only to replace a key. Blank replacements are rejected; clearing remains an explicit DELETE action.

The ordinary connection-settings PUT endpoint does not accept secret fields. API keys can be changed only through the dedicated replacement endpoint.

## Generation workspace persistence

Prompt documents remain in React for undo/redo editing and in `CurrentMediaSession.promptTexts` for durability. Every change to a prompt document, including generated prefixes, typing, undo, redo, and reset, schedules a local save after a short debounce.

Each scheduled save captures a client-side session revision. Starting an Instagram import, local upload, or session reset increments the revision so an old timer cannot write prompt text into a new server session. Manual Save and the pre-generation save remain available and use the same local endpoint.

## Git protection

A dependency-free Node script scans staged Git content before commit. It rejects runtime/private paths and common credential signatures while allowing documented fake test values. A tracked pre-commit hook runs the scanner, and launcher/bootstrap scripts configure `core.hooksPath` locally when the repository has a `.git` directory. `npm run check:secrets` provides an explicit command and is part of `npm run check`.

This guard supplements `.gitignore`; it does not replace it.

## External services

Local persistence does not mean zero network transmission. When invoked, ScrapeCreators, Ollama Cloud, and RunningHub receive the credentials and request data required by their APIs. No connection secret or setting is intentionally sent to GitHub.

## Validation

- Unit tests validate metadata-path allowlisting and traversal rejection.
- Store tests validate `0600`, blank-key rejection, replacement, and clearing.
- Client/source tests validate removal of raw-key reads, password input, and prompt autosave wiring.
- Secret-scanner tests validate blocked credentials, blocked local paths, and allowed ordinary source.
- Manual HTTP checks confirm private URLs return 404 while allowed metadata remains available.
- `npm run check` and `npm audit --omit=dev` must pass.
