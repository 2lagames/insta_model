import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRunningHubCreatePayload,
  runRunningHubImageGeneration,
  type RunningHubPromptJob
} from "./runningHub";

describe("buildRunningHubCreatePayload", () => {
  it("builds a RunningHub advanced workflow request with the prompt node override", () => {
    const payload = buildRunningHubCreatePayload({
      apiKey: "rh_api_key",
      workflowId: "1904136902449209346",
      promptNodeId: "6",
      promptFieldName: "text",
      workflowJson: "{\"6\":{\"inputs\":{\"text\":\"old\"}}}",
      prompt: "{\"high_level_description\":\"A model in the city\"}"
    });

    expect(payload).toEqual({
      apiKey: "rh_api_key",
      workflowId: "1904136902449209346",
      instanceType: "plus",
      workflow: "{\"6\":{\"inputs\":{\"text\":\"old\"}}}",
      nodeInfoList: [{
        nodeId: "6",
        fieldName: "text",
        fieldValue: "{\"high_level_description\":\"A model in the city\"}"
      }]
    });
  });
});

describe("runRunningHubImageGeneration", () => {
  const workflowWithSaveImage = "{\"9\":{\"class_type\":\"SaveImage\",\"inputs\":{\"images\":[\"8\",0]}}}";

  it("creates one task per selected prompt and saves every image returned by RunningHub", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const outputDir = join(tempDir, "output");
    const jobs: RunningHubPromptJob[] = [
      { mediaId: "media-1", label: "First frame", prompt: "{\"a\":1}" },
      { mediaId: "media-2", label: "Image", prompt: "{\"a\":2}" },
      { mediaId: "media-3", label: "Image", prompt: "{\"a\":3}" }
    ];
    const taskIds = ["task-1", "task-2", "task-3"];
    const outputCalls: string[] = [];

    await mkdir(outputDir, { recursive: true });
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        const body = JSON.parse(String(init?.body));
        const taskId = taskIds.shift();
        expect(body.instanceType).toBe("plus");
        expect(body.nodeInfoList).toHaveLength(1);
        expect(body.nodeInfoList[0].fieldName).toBe("text");
        return new Response(JSON.stringify({ code: 0, data: { taskId } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        const body = JSON.parse(String(init?.body));
        outputCalls.push(body.taskId);
        return new Response(JSON.stringify({
          code: 0,
          data: [
            { fileUrl: `https://cdn.example.com/${body.taskId}/image-1.png` },
            { fileUrl: `https://cdn.example.com/${body.taskId}/image-2.png` },
            { fileUrl: `https://cdn.example.com/${body.taskId}/image-3.png` },
            { fileUrl: `https://cdn.example.com/${body.taskId}/image-4.png` }
          ]
        }), { status: 200 });
      }
      if (requestUrl.hostname === "cdn.example.com") {
        return new Response(Buffer.from(`png:${requestUrl.pathname}`), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      const result = await runRunningHubImageGeneration({
        outputDir,
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: workflowWithSaveImage
        },
        jobs,
        onStatus: () => undefined
      });

      expect(outputCalls).toEqual(["task-1", "task-2", "task-3"]);
      expect(result.assets).toHaveLength(12);
      expect(result.item.assets).toHaveLength(12);
      expect(result.item.provider).toBe("runninghub");
      expect(result.item.mediaType).toBe("carousel");
      expect(result.item.files.image).toContain("/output/20260625/");
      expect(result.assets.map((asset) => asset.files.image)).toEqual([
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/"),
        expect.stringContaining("/output/20260625/")
      ]);

      const saved = await readFile(join(outputDir, "20260625", "task-1-image-1.png"));
      expect(saved.toString()).toContain("/task-1/image-1.png");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("waits for output files when RunningHub reports success before outputs are ready", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const outputDir = join(tempDir, "output");
    let outputPolls = 0;

    await mkdir(outputDir, { recursive: true });
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        outputPolls += 1;
        return new Response(JSON.stringify({
          code: 0,
          data: outputPolls === 1
            ? []
            : [
              { fileUrl: "https://cdn.example.com/task-1/image-1.png" },
              { fileUrl: "https://cdn.example.com/task-1/image-2.png" }
            ]
        }), { status: 200 });
      }
      if (requestUrl.hostname === "cdn.example.com") {
        return new Response(Buffer.from(`png:${requestUrl.pathname}`), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      const result = await runRunningHubImageGeneration({
        outputDir,
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        pollIntervalMs: 1,
        maxPolls: 4,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: workflowWithSaveImage
        },
        jobs: [{ mediaId: "media-1", label: "Image", prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      });

      expect(outputPolls).toBe(2);
      expect(result.assets).toHaveLength(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses a shorter default output wait after a task has already succeeded", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    let outputPolls = 0;

    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        outputPolls += 1;
        return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      await expect(runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        pollIntervalMs: 1,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: workflowWithSaveImage
        },
        jobs: [{ mediaId: "media-1", label: "Image", prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("outputs were not ready after 12 checks");

      expect(outputPolls).toBe(12);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects uploaded workflow JSON that only previews images and cannot expose outputs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    let createCalls = 0;
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        createCalls += 1;
      }
      return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        pollIntervalMs: 1,
        maxPolls: 1,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: "{\"25\":{\"class_type\":\"PreviewImage\",\"inputs\":{\"images\":[\"285\",0]}}}"
        },
        jobs: [{ mediaId: "media-1", label: "Image", prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("RunningHub workflow JSON must include a SaveImage node");

      expect(createCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects SaveImage nodes connected to PreviewImage instead of final image data", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    let createCalls = 0;
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        createCalls += 1;
      }
      return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        pollIntervalMs: 1,
        maxPolls: 1,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: JSON.stringify({
            "25": { class_type: "PreviewImage", inputs: { images: ["285", 0] } },
            "292": { class_type: "SaveImage", inputs: { filename_prefix: "IMG_", images: ["25", 1] } }
          })
        },
        jobs: [{ mediaId: "media-1", label: "Image", prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("SaveImage node 292 is connected to PreviewImage node 25");

      expect(createCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a task that returns one image", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        return new Response(JSON.stringify({
          code: 0,
          data: [{ fileUrl: "https://cdn.example.com/task-1/image-1.png" }]
        }), { status: 200 });
      }
      return new Response(Buffer.from("png"), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        config: {
          apiKey: "rh_api_key",
          workflowId: "1904136902449209346",
          promptNodeId: "6",
          promptFieldName: "text",
          workflowJson: workflowWithSaveImage
        },
        jobs: [{ mediaId: "media-1", label: "First frame", prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      });

      expect(result.assets).toHaveLength(1);
      expect(result.item.mediaType).toBe("image");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
