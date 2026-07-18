import type { ImportAsset, ImportItem } from "./importTypes";

export type MediaMaterial = {
  id: string;
  importItem: ImportItem;
  mediaType: "image" | "video";
  label: string;
  files: {
    image?: string;
    video?: string;
    thumbnail?: string;
    firstFrame?: string;
  };
};

export function createMediaMaterials(item: ImportItem): MediaMaterial[] {
  const materials: MediaMaterial[] = [];
  const seen = new Set<string>();
  const addMaterial = (material: MediaMaterial) => {
    const key = [material.mediaType, material.files.video, material.files.image, material.files.firstFrame].join("|");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    materials.push(material);
  };

  const assets = item.assets.length > 0
    ? item.assets
    : [{ id: "media", mediaType: item.mediaType === "video" ? "video" : "image", files: item.files } satisfies ImportAsset];

  for (const asset of assets) {
    if (asset.files.video) {
      addMaterial({
        id: `${item.id}:${asset.id}:video`,
        importItem: item,
        mediaType: "video",
        label: "Reel",
        files: {
          image: asset.files.firstFrame,
          video: asset.files.video,
          firstFrame: asset.files.firstFrame,
          thumbnail: asset.files.thumbnail ?? asset.files.firstFrame
        }
      });
    }

    if (asset.files.firstFrame) {
      addMaterial({
        id: `${item.id}:${asset.id}:first-frame`,
        importItem: item,
        mediaType: "image",
        label: "First frame",
        files: {
          image: asset.files.firstFrame,
          video: asset.files.video,
          thumbnail: asset.files.firstFrame
        }
      });
    } else if (asset.files.image) {
      addMaterial({
        id: `${item.id}:${asset.id}:image`,
        importItem: item,
        mediaType: "image",
        label: "Image",
        files: {
          image: asset.files.image,
          thumbnail: asset.files.thumbnail ?? asset.files.image
        }
      });
    }
  }

  return materials;
}

export function createSessionMediaMaterials(
  items: ImportItem[],
  sessionMediaItemIds: string[],
  selectedItem: ImportItem | undefined,
  isMediaSessionReset: boolean
): MediaMaterial[] {
  const orderedItems = sessionMediaItemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ImportItem => Boolean(item));

  const materials = orderedItems.length === 0 && selectedItem && !isMediaSessionReset
    ? createMediaMaterials(selectedItem)
    : orderedItems.flatMap(createMediaMaterials);

  let imageNumber = 0;
  return materials.map((material) => {
    if (material.mediaType !== "image") {
      return material;
    }

    imageNumber += 1;
    return { ...material, label: `IMAGE ${imageNumber}` };
  });
}
