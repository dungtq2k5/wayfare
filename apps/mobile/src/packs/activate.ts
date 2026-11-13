import { zPlaceSyncRecordStored } from '@wayfare/contracts';
import type { Language, PlaceSyncRecordStored } from '@wayfare/contracts';
import { gunzipSync, strFromU8 } from 'fflate';
import type { Database } from '../db/database';
import { cursorOf, upsertRecord } from '../sync/sync';

/**
 * A Places snapshot as the manifest names it: gzipped NDJSON of `/sync/places` records, each
 * stored leniently (a field the server adds later is dropped, never rejected).
 */
export function recordsOfSnapshot(gzipped: Uint8Array): PlaceSyncRecordStored[] {
  return strFromU8(gunzipSync(gzipped))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => zPlaceSyncRecordStored.parse(JSON.parse(line)));
}

/**
 * Puts a pack's snapshot into the synced Places, in one transaction. A snapshot newer than the
 * area's sync cursor in its language **replaces** the area's rows in that language — a Place
 * removed in between does not linger — and raises the cursor, so delta sync goes on from it. An
 * older or equal one leaves the rows and the cursor alone: a later sync is newer than it.
 */
export async function activateSnapshot(
  db: Database,
  input: {
    areaId: string;
    lang: Language;
    datasetVersion: number;
    records: readonly PlaceSyncRecordStored[];
    now: number;
  },
): Promise<'replaced' | 'kept'> {
  return db.transaction(async (tx) => {
    const cursor = await cursorOf(tx, input.areaId, input.lang);
    if (cursor !== null && input.datasetVersion <= cursor) return 'kept';
    await tx.run('DELETE FROM place_records WHERE area_id = ? AND lang = ?', [
      input.areaId,
      input.lang,
    ]);
    for (const record of input.records) await upsertRecord(tx, record, input.lang);
    await tx.run(
      `INSERT INTO sync_state (area_id, lang, dataset_version, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (area_id, lang) DO UPDATE SET
         dataset_version = excluded.dataset_version, synced_at = excluded.synced_at`,
      [input.areaId, input.lang, input.datasetVersion, input.now],
    );
    return 'replaced';
  });
}
