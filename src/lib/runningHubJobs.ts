import type { PromptMediaInput } from "./promptTypes";
import type { OllamaPreset, StudioActionButton } from "./generationPresets";
import type { RunningHubBinding, StudioId } from "./studioBindings";

export type RunningHubGenerationJobInput = {
  media: PromptMediaInput;
  sourceImage?: PromptMediaInput;
  generatedImage?: PromptMediaInput;
  prompt?: string;
};

export type StoredPromptEntry = {
  value: string;
  managedPrefix: string;
};

export async function prepareRunningHubGenerationJobs(input: {
  bindings: RunningHubBinding[];
  selectedMedia: PromptMediaInput[];
  promptEntriesByMediaId: Map<string, StoredPromptEntry>;
  studioActionButtons: StudioActionButton[];
  ollamaPresets: OllamaPreset[];
  hasOllamaCloudApiKey: boolean;
  generateAndStorePrompt: (media: PromptMediaInput, ollamaPresetId: string) => Promise<string>;
}): Promise<RunningHubGenerationJobInput[]> {
  const promptsByMediaId = new Map(
    Array.from(input.promptEntriesByMediaId, ([mediaId, entry]) => [mediaId, entry.value]),
  );
  const requiresPrompt = input.bindings.some((binding) => (
    binding.studioId === "2" || binding.studioId === "5"
  ));
  let missingPromptMedia: PromptMediaInput[] = [];
  if (requiresPrompt) {
    const validationPromptsByMediaId = new Map(promptsByMediaId);
    for (const media of input.selectedMedia) {
      if (!hasPromptBody(input.promptEntriesByMediaId.get(media.id))) {
        validationPromptsByMediaId.set(media.id, "automatic prompt pending");
      }
    }
    const pendingJobs = createRunningHubGenerationJobs({
      bindings: input.bindings,
      selectedMedia: input.selectedMedia,
      promptsByMediaId: validationPromptsByMediaId,
    });
    missingPromptMedia = pendingJobs
      .map((job) => job.media)
      .filter((media) => !hasPromptBody(input.promptEntriesByMediaId.get(media.id)));
  }

  if (missingPromptMedia.length > 0) {
    const readyOllamaPresetIds = new Set(input.ollamaPresets
      .filter((preset) => (
        Boolean(preset.model.trim())
        && Boolean(preset.promptInstruction.trim())
        && (preset.provider === "local" || input.hasOllamaCloudApiKey)
      ))
      .map((preset) => preset.id));
    const textAction = [...input.studioActionButtons]
      .sort((left, right) => left.order - right.order)
      .find((action) => (
        action.type === "text"
        && Boolean(action.presetId)
        && readyOllamaPresetIds.has(action.presetId!)
      ));
    if (!textAction?.presetId) {
      throw new Error("Configure an Ollama preset in a text action before automatic prompt generation.");
    }

    for (const media of missingPromptMedia) {
      const prompt = await input.generateAndStorePrompt(media, textAction.presetId);
      if (!prompt.trim()) {
        throw new Error(`Automatic prompt generation returned no text for ${media.label}.`);
      }
      promptsByMediaId.set(media.id, prompt);
    }
  }

  return createRunningHubGenerationJobs({
    bindings: input.bindings,
    selectedMedia: input.selectedMedia,
    promptsByMediaId,
  });
}

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

function hasPromptBody(entry: StoredPromptEntry | undefined): boolean {
  const value = entry?.value.trim() ?? "";
  const managedPrefix = entry?.managedPrefix.trim() ?? "";
  return value.length > 0 && value !== managedPrefix;
}
