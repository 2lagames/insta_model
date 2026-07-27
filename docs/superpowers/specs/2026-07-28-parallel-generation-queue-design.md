# Parallel Generation Queue Design

**Date:** 2026-07-28  
**Status:** Approved design pending written-spec review  
**Scope:** Run up to two RunningHub generation jobs concurrently

## 1. Goal

Change the existing persistent image-and-video queue from global concurrency `1` to global concurrency `2`.

The limit is shared across all image and video workflows. At most two local generation jobs may occupy execution slots at once. A third job remains queued until either slot is released.

The change must preserve:

- one shared FIFO queue for images and videos;
- persistent job inputs, phases, provider task IDs, outputs, and errors;
- independent cancellation, retry, and recovery;
- atomic JSON state mutations;
- immediate Generated Media publication for each successful job;
- the existing initial snapshot plus server-sent event update model.

Multiple server processes, distributed workers, Redis, SQLite, per-workflow limits, priorities, and dynamic browser controls for concurrency are out of scope.

## 2. Product decisions

### 2.1. One global two-slot pool

Images and videos compete for the same two slots in queue order. No slot is reserved for a media type or workflow.

The default limit is `2`. The server may set `GENERATION_CONCURRENCY=1` for diagnostics or temporarily conservative operation. Any value other than `1` or `2` fails startup with a clear configuration error, because the known RunningHub account limit is two.

### 2.2. FIFO scheduling

When both slots are free, the first two queued jobs start. When one job reaches a terminal state, the first remaining queued job starts immediately.

Reordering applies only to jobs whose status is `queued`. Moving a queued job never preempts or changes an active job.

All active local phases consume a slot:

- `preparing`;
- `uploading`;
- `submitting`;
- `running`;
- `downloading`;
- `canceling`.

Counting downloading as active is intentionally conservative. It prevents a third local execution from starting until the preceding result has been persisted and published.

### 2.3. Independent outcomes

Each job owns its own abort controller, provider task ID, phase transitions, output, and error.

Failure, cancellation, retry, or completion of one job does not abort, overwrite, or delay another active job except that a released slot may admit the next queued job.

## 3. Architecture

The existing `GenerationQueueStore`, `GenerationWorker`, Express routes, SSE snapshots, and React Queue page remain the main components.

```text
React Queue
  ├─ enqueue and reorder queued jobs
  ├─ cancel or retry one job
  └─ render authoritative SSE snapshots

Express API
  ├─ validate requests
  ├─ persist queue mutations
  └─ wake the scheduler

GenerationQueueStore
  ├─ atomically count active jobs
  ├─ atomically claim the next eligible job
  └─ persist independent phase transitions

GenerationWorker, global concurrency 2
  ├─ scheduler guard
  ├─ Map<jobId, ActiveExecution>
  ├─ fill free slots in FIFO order
  └─ refill one slot after each terminal outcome

ActiveExecution
  ├─ AbortController
  └─ execution Promise
```

The worker remains in the single local Node.js server process. JSON storage is still valid because every claim and transition passes through the serialized `JsonStateStore` mutation boundary.

## 4. Atomic claiming

`GenerationQueueStore.claimNext()` becomes capacity-aware.

Inside one serialized state mutation it:

1. counts jobs in active statuses;
2. returns no job when the count is at the configured limit;
3. finds the first `queued` job;
4. transitions that job to `preparing`;
5. persists and returns the claimed job.

The count and transition occur in the same mutation. Concurrent scheduler wakeups therefore cannot claim the same job or exceed the configured active-job limit.

The store remains the authority for capacity. The worker's in-memory active map manages local promises and cancellation but is not the sole concurrency guard.

## 5. Worker scheduling

`GenerationWorker` receives its concurrency limit in the constructor and replaces its single active execution with:

```ts
Map<string, {
  abortController: AbortController;
  promise: Promise<void>;
}>
```

A serialized scheduling operation fills available slots:

1. claim the next eligible job;
2. register its active execution before starting asynchronous work;
3. continue claiming until capacity is full or the queue is empty;
4. do not await one job before starting the second.

Each execution retains the existing phase and persistence flow. In its `finally` block it:

1. removes only its own active-map entry;
2. publishes the updated queue snapshot;
3. wakes the scheduler so one newly free slot is refilled.

Repeated `wake()` calls are safe and coalesce through a scheduler guard. `whenIdle()` waits until scheduling has settled, the active map is empty, and no queued job can be claimed.

## 6. Cancellation

Cancellation is addressed by job ID.

### 6.1. Queued or pre-submission job

A queued job becomes `canceled` without occupying a slot.

An active job without a provider task ID is aborted locally and becomes `canceled`. Only its own abort controller is triggered.

### 6.2. RunningHub task already exists

When a provider task ID exists:

1. persist `canceling` and `cancelRequestedAt`;
2. send a best-effort cancellation request for that exact RunningHub task;
3. keep the local execution and its slot until RunningHub reaches a terminal state;
4. if RunningHub confirms cancellation or failure after the request, persist `canceled`;
5. if RunningHub completes first, download and persist the successful result, then mark `succeeded`.

The local poller is not immediately discarded after requesting external cancellation. This prevents the application from releasing a slot and submitting a third task while RunningHub may still be executing the canceled task.

Phase updates that arrive while the job is `canceling` must not overwrite the cancellation intent. A successfully completed provider result may still proceed to download and transition from `canceling` to `succeeded`.

If the external cancellation request fails, the activity log reports the failure and provider polling continues while the job remains `canceling`. The final provider outcome determines whether the job becomes `canceled`, `failed`, or `succeeded`. The other active execution continues.

## 7. Startup recovery

Recovery runs before normal slot filling and handles every stored job independently.

| Stored state | Recovery action |
| --- | --- |
| `queued` | Leave queued |
| `preparing` | Return to queued |
| `uploading` without provider task ID | Return to queued |
| `submitting` without provider task ID | Set `recovery_required` |
| `submitting` with provider task ID | Requeue with the task ID and resume it |
| `running` with provider task ID | Requeue with the task ID and resume polling |
| `downloading` with provider task ID | Requeue with the task ID and repeat the status/result lookup and download |
| `canceling` with provider task ID | Reissue best-effort cancellation and resume provider polling without creating a new task |
| terminal state | Leave terminal |

Recovered jobs with provider task IDs never upload inputs or create new RunningHub tasks.

The scheduler applies the same global limit while resuming. If two provider tasks are recovered, both occupy the two slots and later queued jobs wait.

## 8. Queue UI

The Queue page replaces the sequential-execution description with the global two-slot behavior.

It displays a compact capacity summary:

```text
Активно 2 из 2 · Ожидают 4
```

`Активно` counts jobs in execution phases, not all nonterminal jobs. `Ожидают` counts only `queued` jobs.

Multiple rows may simultaneously show preparation, upload, submission, generation, download, or cancellation. Existing per-row Task IDs, progress treatment, cancel/retry actions, and output links remain.

The existing `Активные` filter continues to include both executing and queued jobs. The navigation badge continues to represent all nonterminal jobs.

## 9. Failure handling

- One execution rejection changes only that job to `failed`.
- The other slot keeps running.
- The failed slot is refilled from the queue.
- A transient RunningHub polling failure continues using the existing polling retry behavior.
- A resumable polling failure retains its provider task ID.
- Retrying a provider-terminal failure creates a new task; retrying a resumable polling/download failure reuses the existing task ID.
- Persistence failures do not allow a replacement job to exceed the store's active count.
- Scheduler errors are reported without recursively spawning unbounded wake operations.

## 10. Testing

### 10.1. Queue store

- Two concurrent claims succeed when the limit is two.
- A third concurrent claim returns no job.
- Completing either active job allows exactly the first queued job to be claimed.
- Concurrent claim calls never return the same job.
- Reordering changes only queued-job order.
- Active-state counting includes cancellation and download.

### 10.2. Worker

- Maximum observed executor concurrency is exactly two.
- The first two FIFO jobs start before the third.
- The third starts when either active job finishes.
- One failure does not stop the other execution.
- Canceling one job targets only its abort controller/provider task ID.
- `whenIdle()` waits for both executions and all refill scheduling.
- Repeated wake calls do not exceed capacity.

### 10.3. Recovery

- Two stored provider task IDs resume without task creation.
- A third queued job waits while both recovered slots are occupied.
- Ambiguous submission without a task ID is not automatically retried.
- Cancellation recovery does not release capacity until provider resolution.

### 10.4. Client

- Capacity summary distinguishes executing from queued jobs.
- The Queue description states parallel execution.
- Existing SSE snapshots render two independently active rows.
- Existing output publication, filters, movement controls, and retry behavior remain green.

### 10.5. Full verification

Run:

```bash
npm run check
```

The implementation is complete only when the full test suite, secret check, TypeScript build, and Vite production build pass.

## 11. Acceptance criteria

- The application can execute two image/video generations concurrently.
- It never occupies more than two global local execution slots.
- FIFO order determines which queued job receives the next free slot.
- Each active job can finish, fail, cancel, retry, and recover independently.
- No restart or resumable retry creates a duplicate RunningHub task when a provider task ID is known.
- Queue UI truthfully reports active capacity and waiting count.
- Existing persisted queue data remains readable without migration.
