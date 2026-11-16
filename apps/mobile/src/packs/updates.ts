import type { OfflineManifestDiff, PlaceSyncRecordStored } from '@wayfare/contracts';
import type { Queries } from '../db/database';
import type { Pack, PackUpdate } from './db';
import { deleteFileRows, filesOfPack } from './db';
import type { PackFile } from './plan';
import { SHARED } from './plan';

/** A diff that changes nothing: no Place, no removal, no new map. */
export const isEmptyDiff = (diff: OfflineManifestDiff): boolean =>
  diff.changedPlaceIds.length === 0 && diff.removedPlaceIds.length === 0 && diff.mapPack === null;

const keyOf = (file: PackFile) => `${file.lang}|${file.kind}|${file.name}`;

/**
 * Frame M3's numbers: the bytes still to fetch (a file already verified on the phone is not
 * fetched again), the Places changed, and the stories new — changed Places whose audio the pack did
 * not hold.
 */
export function updateSummary(
  held: readonly PackFile[],
  diff: {
    readonly changedPlaceIds: readonly string[];
    readonly audio: readonly { placeId: string }[];
  },
  incoming: readonly PackFile[],
  since: number,
): PackUpdate {
  const verified = new Set(held.filter((file) => file.verified).map(keyOf));
  const heardOf = new Set(held.filter((file) => file.kind === 'audio').map((file) => file.placeId));
  return {
    bytes: incoming
      .filter((file) => !verified.has(keyOf(file)))
      .reduce((sum, file) => sum + file.bytes, 0),
    changed: diff.changedPlaceIds.length,
    added: diff.audio.filter((audio) => !heardOf.has(audio.placeId)).length,
    since,
  };
}

/**
 * After an update's activation, the pack's files no record of the new snapshot names are deleted —
 * a Place's replaced photo or story, a removed Place's files, the old snapshot, the old map —
 * since the diff names only the old map's files (K14). Matching is by hash, as K13's lookups.
 * Returns the rows removed, for their files to go too.
 */
export async function pruneFiles(
  db: Queries,
  pack: Pack,
  records: readonly PlaceSyncRecordStored[],
  placesName: string,
): Promise<PackFile[]> {
  const photos = new Set(records.flatMap((record) => record.cardPhoto?.sha256 ?? []));
  const audio = new Set(records.flatMap((record) => record.localization.audio?.sha256 ?? []));
  const mapFolder = `map/${pack.mapPackVersion}/`;
  const files = await filesOfPack(db, pack.areaId, pack.lang);
  const stale = files.filter((file) => {
    switch (file.kind) {
      case 'map':
        return !file.name.startsWith(mapFolder);
      case 'places':
        return file.lang === pack.lang && file.name !== placesName;
      case 'photo':
        return file.lang === SHARED && !photos.has(file.sha256);
      case 'audio':
        return file.lang === pack.lang && !audio.has(file.sha256);
    }
  });
  await deleteFileRows(db, stale);
  return stale;
}
