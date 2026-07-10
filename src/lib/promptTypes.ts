import type { SceneBible } from "./importTypes";

export type PromptMediaInput = {
  id: string;
  label: string;
  imagePath: string;
  sourceKind: "photo" | "video-first-frame";
  caption?: string;
  sceneBibleId?: string;
  sceneBible?: SceneBible;
};
