import type { MapPackParts } from '../../map-packs/domain/map-pack-objects';
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

/** The published pack as a manifest names it: the archive, the styles, then the files. */
export function offlineMapPack(
  version: number,
  parts: MapPackParts,
  mediaBase: string,
): OfflineMapPack {
  return {
    version,
    pmtiles: assetOf(parts.pmtiles, mediaBase),
    style: assetOf(parts.style, mediaBase),
    styleDark: parts.styleDark === null ? null : assetOf(parts.styleDark, mediaBase),
    assets: parts.files.map((object) => assetOf(object, mediaBase)),
  };
}

/** Every file of an offline map pack, to weigh it. */
export function mapPackFiles(pack: OfflineMapPack): OfflineAsset[] {
  return [
    pack.pmtiles,
    pack.style,
    ...(pack.styleDark === null ? [] : [pack.styleDark]),
    ...pack.assets,
  ];
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

/**
 * The shape of a snapshot's lines. A snapshot is never rewritten, so a change to the record's
 * shape (`addressVi` made it 2) must change the file's name, or the old file would be read back.
 */
export const SNAPSHOT_FORMAT = 2;

/** A snapshot's file name: the area's own last change and its live count (api-endpoints-plan §2.4). */
export function snapshotPath(areaCode: string, lang: string, areaVersion: bigint, live: number) {
  return `offline/${areaCode}/${lang}/v${SNAPSHOT_FORMAT}-${areaVersion}-${live}.ndjson.gz`;
}
