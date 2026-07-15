import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOllamaVisionRequest,
  defaultOllamaModel,
  defaultPromptInstruction,
  ensureOllamaModel,
  generateIdeogramPromptForMedia
} from "./ideogramPrompt";

describe("buildOllamaVisionRequest", () => {
  it("uses the configured Gemma model by default", () => {
    expect(defaultOllamaModel).toBe("fredrezones55/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b");
  });

  it("exports the existing image-to-prompt instruction as the default editable instruction", () => {
    expect(defaultPromptInstruction).toContain("Describe the attached image exactly as it is visible.");
    expect(defaultPromptInstruction).toContain("Ideogram 4.0 structured JSON caption schema");
    expect(defaultPromptInstruction).toContain("Return valid JSON only. No markdown, no comments, no explanations, no code fences.");
  });

  it("builds a vision request that asks Ollama for Ideogram JSON describing only the input image", () => {
    const request = buildOllamaVisionRequest({
      model: "fredrezones55/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b",
      imageBase64: "image-bytes",
      sourceKind: "video-first-frame",
      caption: "Original Instagram caption"
    });

    expect(request.model).toBe("fredrezones55/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b");
    expect(request.stream).toBe(false);
    expect(request.format).toBe("json");
    expect(request.images).toEqual(["image-bytes"]);
    expect(request.prompt).toContain("Describe the attached image exactly as it is visible.");
    expect(request.prompt).toContain("Ideogram 4.0 structured JSON caption schema");
    expect(request.prompt).toContain("Image summary -> main subject -> pose or action -> secondary elements -> setting/background -> lighting/atmosphere -> framing/composition");
    expect(request.prompt).toContain("Keep high_level_description under 45 words");
    expect(request.prompt).toContain("Use affirmative visual wording");
    expect(request.prompt).toContain("Do not replace the person identity");
    expect(request.prompt).toContain("Return valid JSON only");
    expect(request.prompt).toContain("\"high_level_description\"");
    expect(request.prompt).toContain("\"style_description\"");
    expect(request.prompt).toContain("\"compositional_deconstruction\"");
    expect(request.prompt).toContain("\"elements\"");
    expect(request.prompt).toContain("\"bbox\"");
    expect(request.prompt).toContain("Original Instagram caption");
    expect(request.prompt).not.toContain("User prompt:");
    expect(request.prompt).not.toContain("target model");
    expect(request.prompt).not.toContain("light green-gray almond-shaped eyes");
  });

  it("injects locked scene bible rules when a media item has a scene", () => {
    const request = buildOllamaVisionRequest({
      model: "qwen2.5vl:7b",
      imageBase64: "image-bytes",
      sourceKind: "photo",
      sceneBible: {
        id: "scene_001_bedroom",
        name: "Bedroom",
        sourceMediaIds: ["post-1:asset-1:image"],
        locationSignature: {
          locationType: "bright tropical bedroom",
          environmentKind: "interior",
          keyObjects: ["wood headboard", "black-paned window", "white bedding"],
          lighting: "soft daylight from the left",
          palette: ["cream", "wood", "green"],
          mood: "serene"
        },
        lockedJson: {
          scene_consistency: {
            layout_locks: ["Keep the window on the left."],
            surface_patterns: [{
              surface: "white linen bedding",
              pattern_type: "soft wrinkled linen folds",
              orientation: "diagonal folds",
              scale: "large folds",
              forbidden_alternatives: ["smooth studio backdrop"]
            }],
            forbidden_scene_changes: ["Do not change the bedroom into a studio."]
          },
          compositional_deconstruction: {
            background: "Same bright tropical bedroom with wood headboard and black-paned window."
          }
        }
      }
    });

    expect(request.prompt).toContain("lockedSceneBible");
    expect(request.prompt).toContain("Do not invent a different location");
    expect(request.prompt).toContain("Scene consistency hard constraints");
    expect(request.prompt).toContain("Surface pattern locks");
    expect(request.prompt).toContain("Forbidden scene drift rules");
    expect(request.prompt).toContain("Do not copy negative locked-scene rules into output JSON");
    expect(request.prompt).toContain("Same bright tropical bedroom");
  });

  it("adds fallback hard constraints for legacy scene bibles without scene_consistency", () => {
    const request = buildOllamaVisionRequest({
      model: "qwen2.5vl:7b",
      imageBase64: "image-bytes",
      sourceKind: "photo",
      sceneBible: {
        id: "scene_legacy",
        name: "Bathroom Vanity",
        sourceMediaIds: ["post-1:asset-1:image"],
        locationSignature: {
          locationType: "bathroom vanity area",
          environmentKind: "interior",
          keyObjects: ["round mirror", "green tiled wall", "brass faucet"],
          lighting: "warm light",
          palette: ["green", "brass", "white"],
          mood: "relaxed"
        },
        lockedJson: {
          compositional_deconstruction: {
            background: "The same bathroom vanity area with round mirror, green tiled wall, brass faucet.",
            elements: [{
              type: "obj",
              bbox: [0, 0, 1000, 1000],
              desc: "round mirror"
            }]
          }
        }
      }
    });

    expect(request.prompt).toContain("Preserve legacy scene anchor: round mirror");
    expect(request.prompt).toContain("Do not replace the locked background with a different location type.");
  });
});

describe("generateIdeogramPromptForMedia", () => {
  it("reads selected local media and returns formatted Ideogram JSON generated by Ollama", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ideogram-prompt-"));
    const inputDir = join(tempDir, "input");
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, "frame.jpg"), Buffer.from("fake-jpeg"));

    try {
      const prompt = await generateIdeogramPromptForMedia({
        inputDir,
        model: "qwen2.5vl:7b",
        media: [{
          id: "first-frame",
          label: "First frame",
          imagePath: "/input/frame.jpg",
          sourceKind: "video-first-frame",
          caption: "Caption from Instagram"
        }],
        fetchImpl: (async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe("qwen2.5vl:7b");
          expect(body.format).toBe("json");
          expect(body.images).toEqual([Buffer.from("fake-jpeg").toString("base64")]);
          expect(body.prompt).toContain("Describe the attached image exactly as it is visible.");

          return new Response(JSON.stringify({
            response: JSON.stringify({
              high_level_description: "A vertical bedroom photograph of a woman lying on her side near a rain-streaked window.",
              style_description: {
                aesthetics: "serene, intimate, natural, photorealistic",
                lighting: "soft diffused daylight from a side window",
                photo: "medium close-up, slightly elevated angle, vertical crop",
                medium: "photograph",
                color_palette: ["#F5F0E8", "#B69B7A", "#2F2A24", "#5E8F4D"]
              },
              compositional_deconstruction: {
                background: "A warm neutral bedroom with a large black-paned window showing lush tropical greenery outside.",
                elements: [
                  {
                    type: "obj",
                    bbox: [330, 80, 940, 890],
                    desc: "A woman lying on her side on white bedding, partly covered by beige sheets, with long hair flowing over her shoulder and back."
                  },
                  {
                    type: "obj",
                    bbox: [0, 0, 460, 320],
                    desc: "A tall black-paned window with rain-streaked glass and green foliage visible outside."
                  }
                ]
              }
            })
          }), { status: 200 });
        }) as typeof fetch
      });

      const parsed = JSON.parse(prompt);
      expect(parsed.high_level_description).toContain("vertical bedroom");
      expect(parsed.style_description.medium).toBe("photograph");
      expect(parsed.compositional_deconstruction.background).toContain("bedroom");
      expect(parsed.compositional_deconstruction.elements[0]).toEqual({
        type: "obj",
        bbox: [330, 80, 940, 890],
        desc: "A woman lying on her side on white bedding, partly covered by beige sheets, with long hair flowing over her shoulder and back."
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts Ideogram text elements when visible text is present", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ideogram-prompt-text-"));
    const inputDir = join(tempDir, "input");
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, "poster.jpg"), Buffer.from("fake-jpeg"));

    try {
      const prompt = await generateIdeogramPromptForMedia({
        inputDir,
        model: "qwen2.5vl:7b",
        media: [{
          id: "poster",
          label: "Image",
          imagePath: "/input/poster.jpg",
          sourceKind: "photo"
        }],
        fetchImpl: (async () => new Response(JSON.stringify({
          response: JSON.stringify({
            high_level_description: "A vertical mirror selfie poster-style photograph with visible title text near the top.",
            style_description: {
              aesthetics: "editorial, clean, warm",
              lighting: "soft indoor light",
              photo: "vertical portrait crop, eye-level mirror angle",
              medium: "photograph",
              color_palette: ["#F5F0E8", "#223322", "#FFFFFF"]
            },
            compositional_deconstruction: {
              background: "A green-tile bathroom wall reflected in a round mirror.",
              elements: [
                {
                  type: "text",
                  bbox: [20, 120, 90, 880],
                  text: "SUMMER",
                  desc: "Readable uppercase title text spanning the top of the frame.",
                  color_palette: ["#FFFFFF"]
                }
              ]
            }
          })
        }), { status: 200 })) as typeof fetch
      });

      const parsed = JSON.parse(prompt);
      expect(parsed.compositional_deconstruction.elements[0]).toMatchObject({
        type: "text",
        text: "SUMMER",
        desc: "Readable uppercase title text spanning the top of the frame."
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("ensureOllamaModel", () => {
  it("emits status updates while pulling a missing Ollama model", async () => {
    const updates: string[] = [];
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/api/tags") {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }

      expect(pathname).toBe("/api/pull");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "qwen2.5vl:7b", stream: true });
      return new Response([
        JSON.stringify({ status: "pulling manifest" }),
        JSON.stringify({ status: "downloading digest", completed: 25, total: 100 }),
        JSON.stringify({ status: "success" })
      ].join("\n"), { status: 200 });
    }) as typeof fetch;

    await ensureOllamaModel({
      model: "qwen2.5vl:7b",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      fetchImpl,
      onStatus: (event) => updates.push(event.message)
    });

    expect(updates).toContain("Ollama model qwen2.5vl:7b is not installed. Starting download.");
    expect(updates).toContain("Ollama: pulling manifest");
    expect(updates).toContain("Ollama: downloading digest 25%");
    expect(updates).toContain("Ollama model qwen2.5vl:7b is ready.");
  });

  it("wraps low-level fetch failures with a useful Ollama message", async () => {
    let calls = 0;
    await expect(ensureOllamaModel({
      model: "qwen2.5vl:7b",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      onStatus: () => undefined
    })).rejects.toThrow("Ollama request failed while checking installed models");
  });
});
