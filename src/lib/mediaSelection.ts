export function toggleMediaSelection(currentIds: string[], mediaId: string): string[] {
  if (currentIds.includes(mediaId)) {
    return currentIds.filter((id) => id !== mediaId);
  }

  return [...currentIds, mediaId];
}
