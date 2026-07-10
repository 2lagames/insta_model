import { describe, expect, it, vi } from "vitest";
import { generateSceneBiblesForImport, groupSceneSignatures, parseSceneAnalysisResponse } from "./sceneBible";

const bedroomSignature = {
  locationType: "bright tropical bedroom",
  environmentKind: "interior" as const,
  keyObjects: ["wood headboard", "black window", "white bedding"],
  lighting: "soft daylight from the left",
  palette: ["cream", "wood", "green"],
  mood: "serene",
  persistentElements: [{
    name: "black-paned window",
    category: "architecture" as const,
    bbox: [0, 0, 430, 320] as [number, number, number, number],
    position: "upper left side of the composition",
    visualDetails: ["black mullions", "green foliage outside"],
    mustPreserve: ["window remains on the left", "green foliage remains visible outside"]
  }],
  surfacePatterns: [{
    surface: "white linen bedding",
    bbox: [430, 0, 1000, 1000] as [number, number, number, number],
    patternType: "soft wrinkled linen folds",
    orientation: "diagonal folds across bed",
    scale: "large soft fabric folds",
    colors: ["white", "cream"],
    forbiddenAlternatives: ["smooth studio backdrop", "solid painted floor"]
  }],
  layoutLocks: ["Keep the window on the left and the wood headboard on the right."],
  forbiddenSceneChanges: ["Do not change the bedroom into a studio or hotel lobby."]
};

describe("parseSceneAnalysisResponse", () => {
  it("parses location-only scene analysis JSON", () => {
    const result = parseSceneAnalysisResponse(JSON.stringify({
      media: [{
        mediaId: "post-1:asset-1:image",
        locationSignature: bedroomSignature
      }]
    }));

    expect(result.media[0]).toMatchObject({
      mediaId: "post-1:asset-1:image",
      locationSignature: {
        locationType: "bright tropical bedroom",
        environmentKind: "interior",
        persistentElements: [{
          name: "black-paned window"
        }],
        surfacePatterns: [{
          surface: "white linen bedding",
          patternType: "soft wrinkled linen folds"
        }]
      }
    });
  });

  it("parses scene analysis JSON from markdown wrapped output", () => {
    const result = parseSceneAnalysisResponse([
      "Here is the requested JSON:",
      "```json",
      JSON.stringify({
        media: [{
          mediaId: "post-1:asset-1:image",
          locationSignature: bedroomSignature
        }]
      }),
      "```"
    ].join("\n"));

    expect(result.media[0].mediaId).toBe("post-1:asset-1:image");
    expect(result.media[0].locationSignature.locationType).toBe("bright tropical bedroom");
  });

  it("accepts a bare media array as a shorthand response", () => {
    const result = parseSceneAnalysisResponse(JSON.stringify([{
      mediaId: "post-1:asset-1:image",
      locationSignature: bedroomSignature
    }]));

    expect(result.media).toHaveLength(1);
    expect(result.media[0].mediaId).toBe("post-1:asset-1:image");
  });
});

describe("groupSceneSignatures", () => {
  it("groups similar locations and separates different locations", () => {
    const groups = groupSceneSignatures([
      {
        mediaId: "post-1:a:image",
        locationSignature: bedroomSignature
      },
      {
        mediaId: "post-1:b:image",
        locationSignature: {
          ...bedroomSignature,
          keyObjects: ["white bedding", "wood headboard", "nightstand"]
        }
      },
      {
        mediaId: "post-1:c:image",
        locationSignature: {
          locationType: "marble hotel bathroom",
          environmentKind: "interior",
          keyObjects: ["marble wall", "mirror", "white towels"],
          lighting: "warm indoor light",
          palette: ["white", "chrome", "beige"],
          mood: "clean"
        }
      }
    ]);

    expect(groups.map((group) => group.mediaIds)).toEqual([
      ["post-1:a:image", "post-1:b:image"],
      ["post-1:c:image"]
    ]);
  });
});

describe("generateSceneBiblesForImport", () => {
  it("returns scene bibles and media scene map from Ollama analysis", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: JSON.stringify({
        media: [{
          mediaId: "post-1:asset-1:image",
          locationSignature: bedroomSignature
        }]
      })
    })));

    const result = await generateSceneBiblesForImport({
      inputDir: "/tmp",
      media: [{
        id: "post-1:asset-1:image",
        label: "Image",
        imagePath: "/input/20260626/post-1/image.jpg",
        sourceKind: "photo"
      }],
      model: "test-model",
      fetchImpl,
      readImageBase64: async () => "base64-image"
    });

    expect(result.sceneBibles).toHaveLength(1);
    expect(result.sceneBibles[0].lockedJson).toMatchObject({
      scene_consistency: {
        layout_locks: expect.arrayContaining(["Keep the window on the left and the wood headboard on the right."]),
        forbidden_scene_changes: expect.arrayContaining(["Do not change the bedroom into a studio or hotel lobby."])
      },
      compositional_deconstruction: {
        background: expect.stringContaining("bright tropical bedroom"),
        elements: expect.arrayContaining([
          expect.objectContaining({
            desc: expect.stringContaining("black-paned window")
          })
        ])
      }
    });
    expect(result.mediaSceneMap).toEqual({
      "post-1:asset-1:image": result.sceneBibles[0].id
    });
  });

  it("returns fallback scene data when Ollama returns invalid JSON", async () => {
    const onStatus = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: "I cannot provide JSON for this scene."
    })));

    const result = await generateSceneBiblesForImport({
      inputDir: "/tmp",
      media: [{
        id: "post-1:asset-1:image",
        label: "Image",
        imagePath: "/input/20260626/post-1/image.jpg",
        sourceKind: "photo"
      }],
      model: "test-model",
      fetchImpl,
      readImageBase64: async () => "base64-image",
      onStatus
    });

    expect(result.sceneBibles).toHaveLength(1);
    expect(result.sceneBibles[0]).toMatchObject({
      id: "scene_001_source_media_location",
      name: "Source Media Location",
      sourceMediaIds: ["post-1:asset-1:image"]
    });
    expect(result.mediaSceneMap).toEqual({
      "post-1:asset-1:image": "scene_001_source_media_location"
    });
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      tone: "error",
      source: "scene",
      message: expect.stringContaining("Using fallback scene data")
    }));
  });

  it("splits scene analysis into small batches before grouping scenes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: JSON.stringify({
          media: [
            {
              mediaId: "post-1:asset-1:image",
              locationSignature: bedroomSignature
            },
            {
              mediaId: "post-1:asset-2:image",
              locationSignature: {
                ...bedroomSignature,
                keyObjects: ["white bedding", "wood headboard", "nightstand"]
              }
            }
          ]
        })
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: JSON.stringify({
          media: [{
            mediaId: "post-1:asset-3:image",
            locationSignature: {
              locationType: "green tile bathroom mirror",
              environmentKind: "interior",
              keyObjects: ["green tile wall", "round mirror", "brass faucet"],
              lighting: "warm indoor light",
              palette: ["green", "brass", "white"],
              mood: "warm bathroom mirror selfie"
            }
          }]
        })
      })));

    const result = await generateSceneBiblesForImport({
      inputDir: "/tmp",
      media: [
        {
          id: "post-1:asset-1:image",
          label: "Image 1",
          imagePath: "/input/20260626/post-1/image-001.jpg",
          sourceKind: "photo"
        },
        {
          id: "post-1:asset-2:image",
          label: "Image 2",
          imagePath: "/input/20260626/post-1/image-002.jpg",
          sourceKind: "photo"
        },
        {
          id: "post-1:asset-3:image",
          label: "Image 3",
          imagePath: "/input/20260626/post-1/image-003.jpg",
          sourceKind: "photo"
        }
      ],
      model: "test-model",
      fetchImpl,
      readImageBase64: async (imagePath) => `base64:${imagePath}`
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sceneBibles.map((scene) => scene.sourceMediaIds)).toEqual([
      ["post-1:asset-1:image", "post-1:asset-2:image"],
      ["post-1:asset-3:image"]
    ]);
  });
});
