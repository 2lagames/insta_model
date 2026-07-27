export type GenerationConcurrency = 1 | 2;

export function parseGenerationConcurrency(value: string | undefined): GenerationConcurrency {
  const normalized = value?.trim() ?? "2";
  if (normalized === "1" || normalized === "2") {
    return Number(normalized) as GenerationConcurrency;
  }
  throw new Error("GENERATION_CONCURRENCY must be 1 or 2.");
}
