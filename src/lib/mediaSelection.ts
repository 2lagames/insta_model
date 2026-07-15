export function toggleMediaSelection(currentIds: string[], mediaId: string): string[] {
  if (currentIds.includes(mediaId)) {
    return currentIds.filter((id) => id !== mediaId);
  }

  return [...currentIds, mediaId];
}

export function toggleAllMediaSelection(currentIds: string[], materialIds: string[]): string[] {
  const selectedIds = new Set(currentIds);
  const hasEveryMaterial = materialIds.every((id) => selectedIds.has(id));
  return hasEveryMaterial ? [] : materialIds;
}
