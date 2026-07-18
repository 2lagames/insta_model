import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRunningHubCreatePayload,
  cancelRunningHubTask,
  runRunningHubImageGeneration,
  type RunningHubPromptJob
} from "./runningHub";

describe("buildRunningHubCreatePayload", () => {
  it("builds workflow overrides from any configured Studio ID binding", () => {
    const payload = buildRunningHubCreatePayload({
      apiKey: "rh_api_key",
      workflowId: "workflow",
      bindings: [
        { nodeId: "39", fieldName: "image", studioId: "1" },
        { nodeId: "18", fieldName: "video", studioId: "3" },
        { nodeId: "6", fieldName: "text", studioId: "2" }
      ],
      fieldValues: new Map([
        ["1", "api/source.png"],
        ["2", "A cinematic scene"],
        ["3", "api/source.mp4"]
      ])
    });

    expect(payload.nodeInfoList).toEqual([
      { nodeId: "39", fieldName: "image", fieldValue: "api/source.png" },
      { nodeId: "18", fieldName: "video", fieldValue: "api/source.mp4" },
      { nodeId: "6", fieldName: "text", fieldValue: "A cinematic scene" }
    ]);
  });

  it("builds a RunningHub advanced workflow request with image and prompt node overrides", () => {
    const payload = buildRunningHubCreatePayload({
      apiKey: "rh_api_key",
      workflowId: "1904136902449209346",
      promptNodeId: "6",
      promptFieldName: "text",
      imageNodeId: "39",
      imageFieldName: "image",
      uploadedImageFileName: "api/input.png",
      prompt: "{\"high_level_description\":\"A model in the city\"}"
    });

    expect(payload).toEqual({
      apiKey: "rh_api_key",
      workflowId: "1904136902449209346",
      instanceType: "plus",
      nodeInfoList: [
        {
          nodeId: "39",
          fieldName: "image",
          fieldValue: "api/input.png"
        },
        {
          nodeId: "6",
          fieldName: "text",
          fieldValue: "{\"high_level_description\":\"A model in the city\"}"
        }
      ]
    });
  });
});

describe("cancelRunningHubTask", () => {
  it("posts the API key and task id to RunningHub's cancellation endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: null }))) as typeof fetch;

    await cancelRunningHubTask({
      apiKey: "runninghub-key",
      taskId: "task-1",
      baseUrl: "https://runninghub.example.com",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith(new URL("/task/openapi/cancel", "https://runninghub.example.com"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "runninghub-key", taskId: "task-1" })
    });
  });
});

describe("runRunningHubImageGeneration", () => {
  const sourceImagePath = fileURLToPath(import.meta.url);

  it("uploads a Reel video when a Studio ID 3 binding is configured", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-video-"));
    const imagePath = join(tempDir, "frame.jpg");
    const videoPath = join(tempDir, "reel.mp4");
    const uploadedFileNames: string[] = [];

    await writeFile(imagePath, "image");
    await writeFile(videoPath, "video");
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        uploadedFileNames.push(file.name);
        return new Response(JSON.stringify({ code: 0, data: { fileName: `api/${file.name}` } }));
      }
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        expect(JSON.parse(String(init?.body)).nodeInfoList).toEqual([
          { nodeId: "39", fieldName: "image", fieldValue: "api/frame.jpg" },
          { nodeId: "18", fieldName: "video", fieldValue: "api/reel.mp4" },
          { nodeId: "6", fieldName: "text", fieldValue: "A Reel prompt" }
        ]);
        return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }));
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }));
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        return new Response(JSON.stringify({ code: 0, data: [{ fileUrl: "https://cdn.example.com/result.png" }] }));
      }
      if (requestUrl.hostname === "cdn.example.com") {
        return new Response(Buffer.from("png"));
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      await runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        baseUrl: "https://runninghub.example.com",
        fetchImpl,
        config: {
          apiKey: "rh_api_key",
          workflowId: "workflow",
          bindings: [
            { nodeId: "39", fieldName: "image", studioId: "1" },
            { nodeId: "18", fieldName: "video", studioId: "3" },
            { nodeId: "6", fieldName: "text", studioId: "2" }
          ]
        },
        jobs: [{ mediaId: "reel", label: "First frame", imagePath, videoPath, prompt: "A Reel prompt" }]
      });

      expect(uploadedFileNames).toEqual(["frame.jpg", "reel.mp4"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a configured Studio ID that the selected media does not provide before task creation", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-missing-id-"));
    let requestCount = 0;
    const fetchImpl = (async () => {
      requestCount += 1;
      return new Response("unexpected");
    }) as typeof fetch;

    try {
      await expect(runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        fetchImpl,
        config: {
          apiKey: "rh_api_key",
          workflowId: "workflow",
          bindings: [{ nodeId: "18", fieldName: "video", studioId: "3" }]
        },
        jobs: [{ mediaId: "photo", label: "Image", imagePath: sourceImagePath, prompt: "Prompt" }]
      })).rejects.toThrow("Studio ID 3 has no value");

      expect(requestCount).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uploads the source image before creating a task with both node overrides", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const outputDir = join(tempDir, "output");
    const imagePath = join(tempDir, "source.png");
    const requests: Array<{ pathname: string; init?: RequestInit }> = [];

    await writeFile(imagePath, "source-image");
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.hostname === "runninghub.example.com") {
        requests.push({ pathname: requestUrl.pathname, init });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: { fileName: "api/source.png" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/status")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/outputs")) {
        return new Response(JSON.stringify({ code: 0, data: [{ fileUrl: "https://cdn.example.com/task-1/image.png" }] }), { status: 200 });
      }
      if (requestUrl.hostname === "cdn.example.com") {
        return new Response(Buffer.from("png"), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      await runRunningHubImageGeneration({
        outputDir,
        now: new Date("2026-06-25T10:30:00.000Z"),
        baseUrl: "https://runninghub.example.com",
        fetchImpl,
        config: {
          apiKey: "rh_api_key",
          workflowId: "workflow",
          promptNodeId: "52",
          promptFieldName: "prompt",
          imageNodeId: "39",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "Source image", imagePath, prompt: "new prompt" }]
      });

      expect(requests.map((request) => request.pathname)).toEqual([
        "/task/openapi/upload",
        "/task/openapi/create",
        "/task/openapi/status",
        "/task/openapi/outputs"
      ]);
      expect(requests[0].init?.body).toBeInstanceOf(FormData);
      const uploadForm = requests[0].init?.body as FormData;
      expect(uploadForm.get("apiKey")).toBe("rh_api_key");
      expect(uploadForm.get("file")).toBeInstanceOf(File);
      expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({
        nodeInfoList: [
          { nodeId: "39", fieldName: "image", fieldValue: "api/source.png" },
          { nodeId: "52", fieldName: "prompt", fieldValue: "new prompt" }
        ]
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects an upload response missing data.fileName before creating a task", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const imagePath = join(tempDir, "source.png");
    let createCalls = 0;
    await writeFile(imagePath, "source-image");
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        createCalls += 1;
      }
      throw new Error(`Unexpected request: ${requestUrl.toString()}`);
    }) as typeof fetch;

    try {
      await expect(runRunningHubImageGeneration({
        outputDir: join(tempDir, "output"),
        now: new Date("2026-06-25T10:30:00.000Z"),
        fetchImpl,
        baseUrl: "https://runninghub.example.com",
        config: {
          apiKey: "rh_api_key",
          workflowId: "workflow",
          promptNodeId: "6",
          promptFieldName: "text",
          imageNodeId: "39",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "Image", imagePath, prompt: "new prompt" }]
      })).rejects.toThrow("data.fileName");

      expect(createCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates one task per selected prompt and saves every image returned by RunningHub", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const outputDir = join(tempDir, "output");
    const jobs: RunningHubPromptJob[] = [
      { mediaId: "media-1", label: "First frame", imagePath: sourceImagePath, prompt: "{\"a\":1}" },
      { mediaId: "media-2", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":2}" },
      { mediaId: "media-3", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":3}" }
    ];
    const taskIds = ["task-1", "task-2", "task-3"];
    const outputCalls: string[] = [];

    await mkdir(outputDir, { recursive: true });
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: { fileName: "api/source.png" } }), { status: 200 });
      }
      if (requestUrl.pathname.endsWith("/task/openapi/create")) {
        const body = JSON.parse(String(init?.body));
        const taskId = taskIds.shift();
        expect(body.instanceType).toBe("plus");
        expect(body.nodeInfoList).toEqual([
          { nodeId: "39", fieldName: "image", fieldValue: "api/source.png" },
          expect.objectContaining({ nodeId: "6", fieldName: "text" })
        ]);
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
          imageNodeId: "39",
          imageFieldName: "image"
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
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: { fileName: "api/source.png" } }), { status: 200 });
      }
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
          imageNodeId: "39",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":1}" }],
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
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: { fileName: "api/source.png" } }), { status: 200 });
      }
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
          imageNodeId: "39",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("outputs were not ready after 12 checks");

      expect(outputPolls).toBe(12);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a missing image node before uploading or creating a task", async () => {
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
          imageNodeId: "",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("Add RunningHub image node ID");

      expect(createCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a missing image field before uploading or creating a task", async () => {
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
          imageNodeId: "39",
          imageFieldName: ""
        },
        jobs: [{ mediaId: "media-1", label: "Image", imagePath: sourceImagePath, prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      })).rejects.toThrow("Add RunningHub image field name");

      expect(createCalls).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a task that returns one image", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "runninghub-"));
    const fetchImpl = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith("/task/openapi/upload")) {
        return new Response(JSON.stringify({ code: 0, data: { fileName: "api/source.png" } }), { status: 200 });
      }
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
          imageNodeId: "39",
          imageFieldName: "image"
        },
        jobs: [{ mediaId: "media-1", label: "First frame", imagePath: sourceImagePath, prompt: "{\"a\":1}" }],
        onStatus: () => undefined
      });

      expect(result.assets).toHaveLength(1);
      expect(result.item.mediaType).toBe("image");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
