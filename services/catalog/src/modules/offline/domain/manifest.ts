import type {
  MapPackObject,
  OfflineAsset,
  OfflineAudio,
  OfflineMapPack,
  PlaceSyncRecord,
} from '@wayfare/contracts';

/** A pack object as a device downloads it; a glyph folder's spaces are encoded in its URL. */
export function assetOf(object: MapPackObject, mediaBase: string): OfflineAsset {
  return { ...object, url: `${mediaBase}/${encodeURI(object.path)}` };
}

/** The published pack as a manifest names it: the archive, the style, then the files. */
export function offlineMapPack(
  version: number,
  objects: readonly MapPackObject[],
  mediaBase: string,
): OfflineMapPack {
  const [pmtiles, style, ...files] = objects.map((object) => assetOf(object, mediaBase));
  return { version, pmtiles: pmtiles!, style: style!, assets: files };
}

/**
 * The media a set of records needs offline (api-endpoints-plan §2.4): each card photo once, and
 * each Place's audio in the pack's language where it has one — a Place without it is absent, and
 * the device's on-device voice covers it.
 */
export function mediaOf(
  records: readonly PlaceSyncRecord[],
  toAsset: (object: { url: string; sha256: string; bytes: number }) => OfflineAsset,
): { photos: OfflineAsset[]; audio: OfflineAudio[] } {
  const photos = new Map<string, OfflineAsset>();
  const audio: OfflineAudio[] = [];
  for (const record of records) {
    if (record.cardPhoto !== null) {
      const photo = toAsset(record.cardPhoto);
      photos.set(photo.path, photo);
    }
    const narration = record.localization.audio;
    if (narration !== null) audio.push({ ...toAsset(narration), placeId: record.id });
  }
  return { photos: [...photos.values()], audio };
}

/** What a device downloads in all: every asset listed once. */
export function totalBytes(groups: readonly (readonly { readonly bytes: number }[])[]): number {
  return groups.flat().reduce((sum, asset) => sum + asset.bytes, 0);
}

/** A snapshot's file name: the area's own last change and its live count (api-endpoints-plan §2.4). */
export function snapshotPath(areaCode: string, lang: string, areaVersion: bigint, live: number) {
  return `offline/${areaCode}/${lang}/${areaVersion}-${live}.ndjson.gz`;
}
