# Persistent Generation Queue Design

**Date:** 2026-07-26  
**Status:** Approved design pending written-spec review  
**Scope:** P0 foundation required before batch video generation

## 1. Goal

Replace synchronous, in-memory RunningHub generation control with one persistent local queue for both image and video generation.

The queue must:

- survive browser reloads and local server restarts;
- execute exactly one image or video job at a time;
- preserve each successful result independently;
- expose truthful cancellation and recovery states;
- stream large files instead of buffering them completely in memory;
- continue using JSON storage without SQLite, Redis, or an external service;
- preserve the current workflow-driven preparation logic where possible.

Batch-video pairing and account/bulk Instagram import are not part of this implementation. This work provides the reliable execution foundation they will use later.

## 2. Product decisions

### 2.1. One queue for all RunningHub generations

Image and video generation use the same `GenerationJob` model, worker, recovery process, cancellation behavior, event stream, and Queue UI.

The worker has global concurrency `1`. At most one image or video job may be active.

### 2.2. Existing material behavior remains

The first frame extracted from a video and the original Reel/video remain two independent selectable materials. They support different downstream generation scenarios.

They are linked through:

- `sourceAssetId` — shared origin;
- `selectionGroupId` — mutually exclusive selection group.

Selecting the first frame removes the linked video from the current selection, and selecting the video removes the linked first frame. The rule is enforced in the UI, job builder, and server validation.

### 2.3. Queue placement

The UI receives a separate `Queue` tab.

Studio and Media show a compact summary:

```text
Running 1 · Queued 3 · Failed 1
```

Selecting the summary opens Queue.

Activity Log remains a diagnostic event log. It is not a source of generation state.

## 3. Architectural approach

Use compatible evolution rather than a generation rewrite:

1. Existing client-side prompt preparation and RunningHub job builders remain.
2. Image and video handlers submit prepared jobs to queue endpoints.
3. The API persists jobs and immediately returns their IDs.
4. A background worker in the same Node.js process claims and executes jobs.
5. The UI observes queue state through an initial snapshot plus SSE updates.

The worker is independent from HTTP request lifetimes. Closing or reloading the browser does not stop queue execution.

```text
React
  ├─ prepare prompt and RunningHub inputs
  ├─ POST one or more jobs
  └─ receive job IDs immediately

Express API
  ├─ validate requests
  ├─ persist jobs through QueueStore
  └─ publish queue snapshots/events

GenerationWorker, concurrency 1
  ├─ claim queued job
  ├─ stream uploads
  ├─ submit RunningHub task
  ├─ persist providerTaskId
  ├─ resume/poll task
  ├─ stream output download
  ├─ atomically materialize output
  └─ persist terminal state
```

## 4. Generation job model

```ts
export type GenerationJobKind = "image" | "video";

export type GenerationJobStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "submitting"
  | "running"
  | "downloading"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled"
  | "recovery_required";

export type GenerationJobErrorPhase =
  | "prepare"
  | "upload"
  | "submit"
  | "poll"
  | "download"
  | "persist"
  | "cancel"
  | "recovery";

export type GenerationJobError = {
  phase: GenerationJobErrorPhase;
  code: string;
  message: string;
  retryable: boolean;
  details?: string;
};

export type GenerationJob = {
  id: string;
  idempotencyKey: string;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  input: RunningHubGenerationJob;
  providerTaskId?: string;
  attempt: number;
  output?: GeneratedAsset;
  error?: GenerationJobError;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};
```

`input` is an immutable snapshot. Later UI changes to prompts, workflows, bindings, or material selection do not change an already queued job.

Retries create a new attempt on the same logical job while retaining prior attempt diagnostics. An automatic retry must never occur from an ambiguous `submitting` state.

## 5. State machine

Normal execution:

```text
queued
  → preparing
  → uploading
  → submitting
  → running
  → downloading
  → succeeded
```

Error transitions:

```text
preparing/uploading/submitting/running/downloading
  → failed
```

Cancellation:

```text
queued → canceled

preparing/uploading/running/downloading
  → canceling
  → canceled
  → succeeded
  → failed
```

If RunningHub completes while cancellation is in progress, the result is persisted and the job becomes `succeeded`.

Ambiguous recovery:

```text
submitting without providerTaskId
  → recovery_required
```

The application cannot prove whether RunningHub created a paid external task before the local process stopped. It must not submit the job again automatically. Queue presents a warning and a manual Retry action.

All transitions are validated centrally. Route handlers, the worker, and recovery logic cannot assign arbitrary states.

## 6. JSON persistence

### 6.1. Files

```text
data/generation/queue.json
data/generation/queue.json.bak
data/generation/history/YYYY-MM.json
data/generation/history/YYYY-MM.json.bak
```

`queue.json` contains active and nonterminal jobs. Terminal jobs are copied idempotently into the monthly history file and then removed from the active queue.

Job IDs make archive reconciliation idempotent. A job present in both active and history after a crash is treated as archived and removed from active during startup reconciliation.

### 6.2. JsonStateStore

All mutable JSON state uses one storage abstraction. Direct `writeFile` calls from API routes, import pipelines, queue code, and the worker are prohibited for managed state.

Each write performs:

```text
acquire process mutex
→ load current validated state
→ apply mutation
→ validate next state
→ write temporary file
→ fsync temporary file
→ copy/retain validated backup
→ atomic rename
→ fsync containing directory
→ release mutex
```

The store includes:

- `schemaVersion`;
- runtime validation;
- recovery from the last valid backup;
- an explicit corruption error if both primary and backup are invalid;
- serialized writes within the single Node.js process;
- deterministic formatting for review and backup.

Only one server process may mutate state files. Multiple worker processes and multi-user server deployment are outside the supported JSON architecture.

## 7. Queue store and startup recovery

`GenerationQueueStore` owns:

- creating jobs;
- reading active and archived jobs;
- claiming the next queued job;
- validating state transitions;
- recording provider task IDs;
- recording outputs and structured errors;
- requesting cancellation;
- retrying eligible jobs;
- archiving terminal jobs.

Startup recovery rules:

| Stored state | Recovery action |
| --- | --- |
| `queued` | Leave queued |
| `preparing` | Return to queued |
| `uploading` without provider task | Return to queued after temporary-file cleanup |
| `submitting` without provider task | Set `recovery_required` |
| `running` with provider task | Resume provider polling |
| `downloading` | Validate final/temp files, then resume or repeat download |
| `canceling` | Query provider and continue cancellation resolution |
| terminal state still active | Archive idempotently |

Recovery never creates a second RunningHub task when a provider task ID exists.

The unavoidable crash window after external task creation but before local ID persistence is represented by `recovery_required`; it is never silently retried.

## 8. Generation worker

The worker runs inside the server process but outside HTTP handlers.

Behavior:

1. Recover stored queue state during server initialization.
2. Claim one eligible job.
3. Execute its current phase.
4. Persist every phase transition before continuing.
5. Publish an updated queue event.
6. Save the provider task ID immediately after task creation.
7. Stream the final output to a temporary file.
8. Atomically move the validated file into output storage.
9. Register the output in the media index.
10. Create a video thumbnail/first frame locally.
11. Store the generated asset on the job.
12. Mark the job `succeeded`.
13. Continue with the next queued job.

An error in one job is recorded on that job and does not stop subsequent jobs.

The initial worker concurrency is hard-coded to `1`. A future configurable concurrency setting is outside this P0 implementation.

## 9. Independent output durability

Each job materializes and registers its own output. A request that creates multiple jobs is a grouping operation, not a transaction around all results.

The persistence order is:

1. stream into a temporary output file;
2. validate content type and non-zero size;
3. fsync and atomically move the file;
4. register the media index entry through strengthened JSON storage;
5. attach the generated asset to the job;
6. transition the job to `succeeded`.

Because files, media index, and queue JSON cannot share a transaction, startup reconciliation checks:

- output file exists but media record is missing;
- media record exists but job output is missing;
- job is `downloading` but a valid final file already exists;
- temporary files left by interrupted transfers.

Reconciliation completes safe missing links and never deletes a valid generated result automatically.

## 10. Streaming I/O

The following paths must not create a full-file Buffer:

- browser upload to local API;
- Instagram/Apify download to disk;
- local input upload to RunningHub;
- RunningHub output download to disk.

Each path uses Node streams and `pipeline`, with:

- AbortSignal propagation;
- phase-specific timeout;
- maximum byte count;
- Content-Length validation when available;
- final actual-size validation;
- free-space preflight for large downloads;
- temporary-file cleanup on error or cancellation.

The local upload route must stream the raw request before any body parser consumes it.

## 11. Cancellation

Canceling a queued job transitions directly to `canceled`.

Canceling an active job:

1. persists `canceling` and `cancelRequestedAt`;
2. disables conflicting actions;
3. aborts local streaming/polling where safe;
4. requests RunningHub cancellation when a provider task ID exists;
5. queries the final provider state;
6. transitions to `canceled`, `succeeded`, or `failed`.

The UI does not report cancellation before the server persists a terminal state.

On restart, `canceling` jobs are reconciled with RunningHub before the next queued job is claimed.

## 12. API

```text
GET  /api/generation-jobs
POST /api/generation-jobs/image
POST /api/generation-jobs/video
POST /api/generation-jobs/:id/cancel
POST /api/generation-jobs/:id/retry
GET  /api/generation-events
```

Image and video creation endpoints accept prepared RunningHub jobs and return:

```ts
type CreateGenerationJobsResponse = {
  jobs: GenerationJob[];
};
```

They do not wait for RunningHub completion.

The snapshot endpoint returns active jobs plus bounded recent history. SSE publishes queue updates, but reconnecting clients always refresh from the snapshot rather than assuming that every event was received.

Retry is permitted for `failed` and `recovery_required`. Retrying `recovery_required` requires an explicit confirmation flag in the request.

## 13. Queue UI

Navigation adds a dedicated `Queue` tab.

Queue filters:

- `Active`;
- `Failed`;
- `Completed`;
- `All`.

Each row shows:

- input preview;
- `Image` or `Video`;
- workflow label;
- creation time;
- status and phase;
- provider task ID in details;
- structured error;
- output preview/link;
- contextual action: `Cancel`, `Retry`, or `Open`.

Studio and Media retain a compact queue summary. Selecting it opens Queue.

Submitting generation:

1. prepares missing prompts using the existing behavior;
2. creates the requested independent jobs;
3. reports `Добавлено в очередь: N`;
4. clears the local blocking generation flag;
5. lets Queue/SSE represent ongoing work.

`recovery_required` displays a warning that an external task may already have been created and that Retry can spend credits again.

## 14. Error model

```ts
export type GenerationJobError = {
  phase:
    | "prepare"
    | "upload"
    | "submit"
    | "poll"
    | "download"
    | "persist"
    | "cancel"
    | "recovery";
  code: string;
  message: string;
  retryable: boolean;
  details?: string;
};
```

`message` is safe and understandable for the UI. `details` contains bounded technical diagnostics without secrets, credentials, or raw request headers.

Provider access or subscription errors are non-retryable until configuration changes. Network timeouts and interrupted downloads are retryable. Ambiguous external submission is `recovery_required`, not an ordinary retryable failure.

## 15. Testing strategy

### Storage

- concurrent mutations preserve all jobs;
- invalid next state is rejected before write;
- primary corruption restores the validated backup;
- corruption of both files produces a clear startup error;
- interrupted temp files do not replace valid state;
- archive reconciliation is idempotent.

### State machine and queue

- every allowed transition succeeds;
- every disallowed transition fails;
- claim returns at most one job;
- queued cancellation is immediate;
- active cancellation persists `canceling`;
- explicit confirmation is required to retry `recovery_required`.

### Worker and recovery

- global concurrency never exceeds one;
- image and video jobs share the same worker;
- a failed second job does not change the first successful output;
- running jobs with provider task IDs resume polling;
- submitting jobs without provider task IDs become `recovery_required`;
- recovery never resubmits a known provider task;
- canceling jobs reconcile before new work starts.

### Output and streaming

- output becomes visible after each successful job;
- video success produces a thumbnail;
- failed and canceled streams remove temporary files;
- large transfers use streams and enforce byte limits;
- reconciliation repairs safe file/index/job gaps.

### API and UI

- create endpoints return job IDs without waiting for generation;
- cancel and retry enforce state rules;
- SSE reconnect uses a fresh snapshot;
- Queue restores after browser reload;
- the summary counts active, queued, and failed jobs correctly;
- `recovery_required` warns about possible duplicate credit use.

### Regression

- existing image prompt preparation remains;
- existing video input binding remains;
- repeats create independent jobs;
- existing generated-media indexing remains compatible;
- the complete Vitest and production build checks pass.

## 16. Out of scope

- batch pairing modes `1:1`, `1:N`, `N:1`, and `N:M`;
- account and multi-link Instagram import;
- configurable worker concurrency;
- multiple worker processes;
- multi-user access;
- SQLite or Redis;
- automatic retry after ambiguous external submission;
- deleting old generated media;
- redesigning workflow settings beyond showing a usable label in Queue.

## 17. Implementation order

1. Generation schemas and validated state transitions.
2. Hardened `JsonStateStore`.
3. Material selection grouping and server validation.
4. Streaming file primitives.
5. Persistent `GenerationQueueStore`.
6. Startup recovery.
7. Background worker with concurrency one.
8. Independent output persistence and video thumbnails.
9. Persistent cancellation.
10. Queue API and SSE.
11. Queue tab and compact summary.
12. Restart, corruption, concurrency, large-file, and regression verification.

