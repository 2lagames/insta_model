import { describe, expect, it, vi } from "vitest";
import { GenerationController, GenerationCancelledError } from "./generationController";

describe("GenerationController", () => {
  it("aborts the active generation and cancels every created RunningHub task", async () => {
    const cancelRunningHubTask = vi.fn().mockResolvedValue(undefined);
    const controller = new GenerationController(cancelRunningHubTask);
    const generation = controller.start();
    generation.registerRunningHubTask({ apiKey: "runninghub-key", taskId: "task-1" });
    generation.registerRunningHubTask({ apiKey: "runninghub-key", taskId: "task-2" });

    await controller.cancel();

    expect(generation.signal.aborted).toBe(true);
    expect(cancelRunningHubTask).toHaveBeenCalledTimes(2);
    expect(cancelRunningHubTask).toHaveBeenCalledWith({ apiKey: "runninghub-key", taskId: "task-1" });
    expect(cancelRunningHubTask).toHaveBeenCalledWith({ apiKey: "runninghub-key", taskId: "task-2" });
    expect(() => generation.throwIfCancelled()).toThrow(GenerationCancelledError);
  });

  it("releases the active generation after it finishes", () => {
    const controller = new GenerationController(async () => undefined);
    const generation = controller.start();

    controller.finish(generation);

    expect(controller.hasActiveGeneration()).toBe(false);
  });
});
