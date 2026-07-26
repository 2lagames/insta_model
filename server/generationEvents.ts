import type { Response } from "express";
import type { GenerationJob } from "../src/lib/generationJobs";

export class GenerationEvents {
  private readonly subscribers = new Set<Response>();
  private jobs: GenerationJob[] = [];

  publish(jobs: GenerationJob[]): void {
    this.jobs = jobs;
    const event = formatGenerationSnapshotEvent(jobs);
    for (const subscriber of this.subscribers) subscriber.write(event);
  }

  subscribe(response: Response): () => void {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    response.write("retry: 1000\n\n");
    response.write(formatGenerationSnapshotEvent(this.jobs));
    this.subscribers.add(response);
    return () => this.subscribers.delete(response);
  }
}

export function formatGenerationSnapshotEvent(jobs: GenerationJob[]): string {
  return ["event: generation-snapshot", `data: ${JSON.stringify({ jobs })}`, "", ""].join("\n");
}
