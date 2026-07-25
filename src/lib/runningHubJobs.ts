import type { PromptMediaInput } from "./promptTypes";
import type { RunningHubBinding, StudioId } from "./studioBindings";

export type RunningHubGenerationJobInput = {
  media: PromptMediaInput;
  sourceImage?: PromptMediaInput;
  generatedImage?: PromptMediaInput;
  prompt?: string;
};

export function createRunningHubGenerationJobs(input: {
  bindings: RunningHubBinding[];
  selectedMedia: PromptMediaInput[];
  promptsByMediaId: Map<string, string>;
}): RunningHubGenerationJobInput[] {
  const requiredStudioIds = new Set<StudioId>(input.bindings.map((binding) => binding.studioId));
  const requiresSourceImage = requiredStudioIds.has("1");
  const requiresPrompt = requiredStudioIds.has("2") || requiredStudioIds.has("5");
  const requiresSourceVideo = requiredStudioIds.has("3");
  const requiresGeneratedImage = requiredStudioIds.has("4");
  const requiresSourceMedia = requiresSourceImage || requiresSourceVideo;
  const sourceMedia = input.selectedMedia.filter((media) => !media.generatedImagePath);
  const standaloneSourceImages = sourceMedia.filter((media) => Boolean(media.imagePath) && !media.videoPath);
  const generatedImages = input.selectedMedia.filter((media) => Boolean(media.generatedImagePath));

  let jobMedia: PromptMediaInput[];
  if (requiresSourceImage && requiresSourceVideo) {
    jobMedia = sourceMedia.filter((media) => Boolean(media.videoPath));
    if (standaloneSourceImages.length !== 1) {
      throw new Error("Select exactly one source image required by the selected workflow.");
    }
    if (jobMedia.length === 0) {
      throw new Error(createMissingSourceMessage(requiresSourceImage, requiresSourceVideo));
    }
  } else if (requiresSourceMedia) {
    jobMedia = sourceMedia.filter((media) => (
      (!requiresSourceImage || Boolean(media.imagePath))
      && (!requiresSourceVideo || Boolean(media.videoPath))
    ));
    if (jobMedia.length === 0) {
      throw new Error(createMissingSourceMessage(requiresSourceImage, requiresSourceVideo));
    }
  } else if (requiresGeneratedImage) {
    jobMedia = generatedImages;
    if (jobMedia.length === 0) {
      throw new Error("Select one or more generated images required by the selected workflow.");
    }
  } else {
    jobMedia = input.selectedMedia;
  }

  if (jobMedia.length === 0) {
    throw new Error("Select one or more Media items before generation.");
  }

  if (requiresGeneratedImage && requiresSourceMedia && generatedImages.length !== 1) {
    throw new Error("Select exactly one generated image required by the selected workflow.");
  }

  return jobMedia.map((media) => {
    const prompt = input.promptsByMediaId.get(media.id);
    if (requiresPrompt && !prompt?.trim()) {
      throw new Error(`Write or generate a prompt for ${media.label}; the selected workflow requires a prompt.`);
    }

    return {
      media,
      ...(requiresSourceImage && requiresSourceVideo ? { sourceImage: standaloneSourceImages[0] } : {}),
      ...(requiresGeneratedImage
        ? { generatedImage: requiresSourceMedia ? generatedImages[0] : media }
        : {}),
      ...(requiresPrompt ? { prompt: prompt!.trim() } : {})
    };
  });
}

function createMissingSourceMessage(requiresSourceImage: boolean, requiresSourceVideo: boolean): string {
  if (requiresSourceImage && requiresSourceVideo) {
    return "Select source media containing both an image and a video required by the selected workflow.";
  }
  return requiresSourceVideo
    ? "Select one or more source videos required by the selected workflow."
    : "Select one or more source images required by the selected workflow.";
}
