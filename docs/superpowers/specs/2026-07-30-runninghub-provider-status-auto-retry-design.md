# RunningHub Provider-Status Auto-Retry Design

**Date:** 2026-07-30  
**Status:** Approved design pending written-spec review  
**Scope:** Automatically retry generation jobs that RunningHub reports as failed

## 1. Goal

Preserve a generation when RunningHub accepts the task but reports that its
workflow did not run successfully.

When RunningHub returns a recognized terminal failure status, the local
generation job must:

- return to the front of the waiting queue;
- create a new RunningHub task on its next execution;
- run no more than three attempts in one automatic retry sequence, including the
  initial attempt;
- remain failed with the last provider error after the third failed attempt.

Network errors, HTTP errors, upload failures, local persistence errors, polling
timeouts, and user-requested cancellation are outside this automatic-retry
policy.

## 2. Recognized provider failures

The RunningHub result-query response is the authority for this policy. A task is
a terminal provider failure when its normalized status is one of the existing
English failure values or a supported Chinese failure value.

The initial supported values are:

- `FAIL`, `FAILED`, `ERROR`, `CANCELED`, and `CANCELLED`;
- `失败`, `错误`, `异常`, `取消`, and `已取消`;
- the observed RunningHub value `工作流运行失败`.

Comparison ignores surrounding whitespace and English letter case. Chinese
values are matched exactly after trimming so unrelated provider messages do not
accidentally trigger a paid retry.

RunningHub response code `805` or a populated `failedReason` from the task query
also represents a terminal task-execution failure. It is classified through the
same provider-terminal error path, not as a transport or HTTP failure.

## 3. Queue behavior

`GenerationWorker` handles a recognized terminal provider error according to the
job's current state and attempt number.

### 3.1. Attempts one and two

If the job was not canceled by the user and `attempt < 3`, the queue atomically:

1. transitions the job back to `queued`;
2. increments `attempt`;
3. clears `providerTaskId`, because the failed external task must not be resumed;
4. clears output, cancellation, completion, and previous error fields used by
   the active attempt;
5. places the job before ordinary queued jobs.

Already active jobs are not interrupted or reordered. Returning the failed job
to the queue releases its current worker slot. The scheduler then claims it as
the next eligible waiting job while respecting the configured global
concurrency.

### 3.2. Third attempt

If `attempt` is already `3`, the worker records the job as `failed` with:

- phase `poll`;
- code `RUNNINGHUB_PROVIDER_FAILED`;
- the provider's latest status and error message;
- `retryable: false`.

The existing manual Retry action remains available and starts a new attempt only
when the user explicitly requests it.

### 3.3. User cancellation

If the local job is `canceling`, a provider terminal failure resolves the job as
`canceled`. It never invokes automatic retry, including when the provider status
is `CANCELED`, `取消`, or `已取消`.

## 4. Component changes

### 4.1. RunningHub response classification

`server/runningHub.ts` centralizes terminal status recognition in a small helper.
Task-query handling extracts and classifies provider state before generic payload
validation can erase a task-execution failure behind a generic error.

Recognized failures continue to throw `RunningHubTerminalTaskError` with the
original provider status and diagnostic message.

### 4.2. Atomic queue mutation

`server/generationQueueStore.ts` adds one operation dedicated to automatic
provider retries. It validates the current active status, increments the attempt,
clears the failed task identity, and moves the job ahead of ordinary queued work
in one serialized JSON mutation.

The operation does not apply to manually failed jobs, recovered ambiguous
submissions, transport errors, or user cancellation.

### 4.3. Worker policy

`server/generationWorker.ts` applies the three-attempt limit only when catching
`RunningHubTerminalTaskError`. Other existing error and recovery paths remain
unchanged.

The worker publishes the requeued snapshot and exits the current execution. Its
normal `finally` path releases the slot and wakes the scheduler.

## 5. State flow

```text
running
  → RunningHub terminal failure
    → attempt 1 or 2: queued at priority position, attempt + 1, taskId cleared
    → attempt 3: failed with RUNNINGHUB_PROVIDER_FAILED

canceling
  → RunningHub terminal failure
    → canceled
```

The automatic path never resumes a failed provider task and never exceeds three
attempts in the automatic sequence.

## 6. Testing

### 6.1. RunningHub classification

- Existing English failure statuses remain terminal.
- `工作流运行失败` is terminal.
- The supported shorter Chinese failure statuses are terminal.
- Queued, running, and successful statuses do not trigger failure.
- Task-query code `805` or `failedReason` is surfaced as
  `RunningHubTerminalTaskError`.

### 6.2. Queue store

- Automatic provider retry increments the attempt and clears `providerTaskId`.
- The retried job is placed before ordinary queued jobs.
- The mutation rejects ineligible states.

### 6.3. Worker

- A provider terminal failure on attempt one is requeued and executed next.
- Attempts two and three create fresh provider task IDs.
- The third provider failure remains terminal and does not cause a fourth
  execution.
- `工作流运行失败` follows the same three-attempt policy.
- A provider failure received while the job is canceling produces `canceled`,
  not a retry.
- Unrelated network, HTTP, upload, local, and polling errors retain their current
  behavior.

## 7. Non-goals

- Configurable retry counts or delays.
- Exponential backoff.
- Automatic retries for HTTP `429` or `5xx`.
- Automatic retries for transport, upload, download, or local persistence
  failures.
- A new retry-history data model or Queue UI.
