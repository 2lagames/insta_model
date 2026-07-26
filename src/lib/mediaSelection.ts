export function toggleMediaSelection(currentIds: string[], mediaId: string): string[] {
  if (currentIds.includes(mediaId)) {
    return currentIds.filter((id) => id !== mediaId);
  }

  return [...currentIds, mediaId];
}

export function toggleExclusiveMediaSelection(
  currentIds: string[],
  mediaId: string,
  materials: Array<{ id: string; selectionGroupId: string }>
): string[] {
  if (currentIds.includes(mediaId)) return currentIds.filter((id) => id !== mediaId);
  const selected = materials.find((material) => material.id === mediaId);
  if (!selected) return [...currentIds, mediaId];
  const linkedIds = new Set(materials
    .filter((material) => material.selectionGroupId === selected.selectionGroupId)
    .map((material) => material.id));
  return [...currentIds.filter((id) => !linkedIds.has(id)), mediaId];
}

export function toggleAllMediaSelection(currentIds: string[], materialIds: string[]): string[] {
  const selectedIds = new Set(currentIds);
  const hasEveryMaterial = materialIds.every((id) => selectedIds.has(id));
  return hasEveryMaterial ? [] : materialIds;
}
