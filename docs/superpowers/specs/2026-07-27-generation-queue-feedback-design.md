# Generation Queue Feedback and Deduplication

## Problem

The browser can briefly show the same newly enqueued generation job twice. The server publishes the new queue snapshot over server-sent events and also returns the created job from the enqueue request. If the live snapshot arrives first, the enqueue response appends the same job to client state a second time. A later authoritative snapshot removes the duplicate.

Queued jobs can already be moved on the server, but repeated jobs often have the same preview, label, and creation time. Without a visible position or movement feedback, a successful reorder is difficult to recognize.

## Desired Behavior

- One server generation job appears once in the browser, regardless of whether the enqueue response or live snapshot arrives first.
- Every waiting job shows its current one-based position among queued jobs.
- After a successful move, the moved row is briefly highlighted at its new position.
- Move controls are disabled for that row while the request is pending.
- A failed move leaves the current order visible and reports the existing application error message.
- Image and video generation use the same queue-state rules.

## Design

### Queue State

Add a pure client helper that merges newly enqueued jobs into the current list by `job.id`. Existing jobs retain their current order and data; only jobs whose IDs are not already present are appended. Both image and video enqueue handlers use this helper instead of blindly appending the response.

Live generation snapshots remain authoritative and continue replacing the complete client queue state.

### Reorder Feedback

The queue page derives each queued job's position from the full ordered job list. The row displays `№N в очереди` next to its existing metadata.

When a move button is pressed:

1. Mark that job as moving and disable its arrow buttons.
2. Await the move request.
3. Apply the returned full queue order.
4. Mark the job as recently moved.
5. Highlight the row at its new position for a short fixed interval.

If the request fails, clear the moving state without showing a success highlight. Existing application-level error reporting handles the message.

The interaction remains button-based. Drag-and-drop is outside this change.

## Components

- `src/lib/generationQueueView.ts`: pure deduplication and queued-position helpers.
- `src/App.tsx`: enqueue-state merge, asynchronous move state, row metadata, and highlight class.
- `src/App.css`: moving-button state and brief moved-row highlight.

No server persistence or API contract changes are required.

## Testing

- A unit test proves that merging an enqueue response after the same live snapshot does not duplicate a job.
- A unit test proves queued positions ignore active and terminal jobs while preserving queued order.
- Queue layout tests verify the move handler is awaited, movement controls can be disabled, and position/highlight UI is wired.
- Existing queue-store tests continue to verify the persisted reorder behavior.
- Run `npm run check` to cover secrets, all tests, TypeScript, and the production build.
