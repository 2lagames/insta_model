import type { Response } from "express";

export type ActivityTone = "idle" | "running" | "error" | "ready";

export type ActivityEvent = {
  id: string;
  tone: ActivityTone;
  message: string;
  createdAt: string;
  source?: string;
};

export class ActivityLog {
  private events: ActivityEvent[] = [];
  private subscribers = new Set<Response>();
  private nextId = 1;

  publish(event: Omit<ActivityEvent, "id" | "createdAt"> & { createdAt?: string }): ActivityEvent {
    const activityEvent: ActivityEvent = {
      id: String(this.nextId++),
      createdAt: event.createdAt ?? new Date().toISOString(),
      tone: event.tone,
      message: event.message,
      source: event.source
    };

    this.events = [...this.events.slice(-199), activityEvent];
    for (const subscriber of this.subscribers) {
      subscriber.write(formatSseEvent(activityEvent));
    }

    return activityEvent;
  }

  subscribe(response: Response): () => void {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    response.write("retry: 1000\n\n");

    for (const event of this.events.slice(-50)) {
      response.write(formatSseEvent(event));
    }

    this.subscribers.add(response);
    return () => {
      this.subscribers.delete(response);
    };
  }
}

export function formatSseEvent(event: ActivityEvent): string {
  return [
    `id: ${event.id}`,
    "event: activity",
    `data: ${JSON.stringify(event)}`,
    "",
    ""
  ].join("\n");
}
