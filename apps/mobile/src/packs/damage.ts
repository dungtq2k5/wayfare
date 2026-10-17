import type { Queries } from '../db/database';
import { allPacks, filesOfPack, setPackState, setVerified, USED_STATES } from './db';
import type { PackFile } from './plan';

/**
 * At launch, every pack in use is checked for presence and size — a cheap stat, not a hash. A file
 * missing or of the wrong size is marked unverified and its pack `damaged`; the rest stays in use,
 * and *Repair* fetches only the unverified files (K16).
 * ponytail: no re-hash at launch; a full re-hash is the upgrade if a bit-flipped file is ever seen.
 */
export async function checkPacks(
  db: Queries,
  sizeOf: (file: PackFile) => number | null,
): Promise<number> {
  let damaged = 0;
  for (const pack of await allPacks(db)) {
    if (!USED_STATES.includes(pack.state)) continue;
    let broken = false;
    for (const file of await filesOfPack(db, pack.areaId, pack.lang)) {
      if (!file.verified) {
        broken = true;
        continue;
      }
      if (sizeOf(file) !== file.bytes) {
        await setVerified(db, file, false);
        broken = true;
      }
    }
    if (broken && pack.state !== 'damaged') {
      await setPackState(db, pack.areaId, pack.lang, 'damaged');
      damaged += 1;
    }
  }
  return damaged;
}

/** What a damaged pack cannot serve, for frame M4: its stories (by Place) and the bytes to repair. */
export function damageOf(files: readonly PackFile[]): { stories: number; bytes: number } {
  const broken = files.filter((file) => !file.verified);
  return {
    stories: broken.filter((file) => file.kind === 'audio').length,
    bytes: broken.reduce((sum, file) => sum + file.bytes, 0),
  };
}
