import { create } from 'zustand';
import { databaseReady } from '../data/boot';
import type { Pack } from './db';
import { allPacks, USED_STATES, usedFiles } from './db';
import { packFile } from './files';

interface PackIndex {
  /** A verified photo's file, by its `sha256` (K13). */
  photos: ReadonlyMap<string, string>;
  /** A verified story's file, by its `sha256`: used only while the record names that hash. */
  audio: ReadonlyMap<string, string>;
  /** Each area's pack in use, for its map (K12). */
  areas: ReadonlyMap<string, Pack>;
}

/**
 * What the packs in use hold, in memory: a photo, a story or a map is looked up here without
 * waiting on the database. Read again whenever a pack is installed, updated, repaired or deleted.
 */
export const usePackIndex = create<PackIndex>(() => ({
  photos: new Map(),
  audio: new Map(),
  areas: new Map(),
}));

export async function refreshPackIndex(): Promise<void> {
  const db = await databaseReady;
  const files = await usedFiles(db);
  const photos = new Map<string, string>();
  const audio = new Map<string, string>();
  for (const file of files) {
    const uri = packFile(file.areaId, file.name).uri;
    if (file.kind === 'photo') photos.set(file.sha256, uri);
    if (file.kind === 'audio') audio.set(file.sha256, uri);
  }
  const areas = new Map<string, Pack>();
  for (const pack of await allPacks(db)) {
    if (!USED_STATES.includes(pack.state) || pack.map === null) continue;
    // Any language's pack serves the area's map (frame M6).
    if (!areas.has(pack.areaId)) areas.set(pack.areaId, pack);
  }
  usePackIndex.setState({ photos, audio, areas });
}

/** A photo from a downloaded pack when one holds it, matched by the record's hash; else its URL (K13). */
export function usePhotoUri(url: string | null, sha256?: string | null): string | null {
  const local = usePackIndex((index) => (sha256 ? index.photos.get(sha256) : undefined));
  return local ?? url;
}

/**
 * A downloaded pack's story for this audio, by its hash — so a story changed by sync since the
 * pack never plays its old file over the new transcript (K13). A pack file was verified on
 * arrival, so it is not hashed again.
 */
export function packAudioUri(sha256: string): string | null {
  return usePackIndex.getState().audio.get(sha256) ?? null;
}
