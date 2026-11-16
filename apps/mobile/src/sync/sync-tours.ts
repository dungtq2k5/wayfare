import { zTourSyncRecordStored } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import type { Database } from '../db/database';

/** One tours page as the sync reads it from the wire. */
export interface ToursPage {
  readonly tours: readonly unknown[];
  readonly removedTourIds: readonly string[];
  readonly datasetVersion: number;
  readonly complete: boolean;
}

export interface ToursClient {
  tours(request: { areaId: string; lang: Language; since: number | undefined }): Promise<ToursPage>;
}

const DELETE_CHUNK = 500;

/**
 * Brings one area's tours up to date (`GET /sync/tours`), as its Places are: pages from the stored
 * version until `complete`, each page in one transaction with its cursor. A tour's stops are Place
 * ids by position; which are live the phone decides from its own Places (K7).
 */
export async function syncAreaTours(input: {
  db: Database;
  client: ToursClient;
  areaId: string;
  lang: Language;
  now: () => number;
}): Promise<number> {
  const { db, client, areaId, lang } = input;
  const [row] = await db.all<{ dataset_version: number }>(
    'SELECT dataset_version FROM tour_sync_state WHERE area_id = ? AND lang = ?',
    [areaId, lang],
  );
  let cursor = row?.dataset_version ?? null;
  let written = 0;
  for (;;) {
    const page = await client.tours({ areaId, lang, since: cursor ?? undefined });
    if (!page.complete && cursor !== null && page.datasetVersion <= cursor) {
      throw new Error(`Tours sync of ${areaId} is not advancing past ${cursor}`);
    }
    const records = page.tours.map((tour) => zTourSyncRecordStored.parse(tour));
    await db.transaction(async (tx) => {
      for (const record of records) {
        await tx.run(
          `INSERT INTO tour_records (tour_id, lang, area_id, record_json) VALUES (?, ?, ?, ?)
           ON CONFLICT (tour_id, lang) DO UPDATE SET
             area_id = excluded.area_id, record_json = excluded.record_json`,
          [record.id, lang, record.areaId, JSON.stringify(record)],
        );
      }
      for (let i = 0; i < page.removedTourIds.length; i += DELETE_CHUNK) {
        const ids = page.removedTourIds.slice(i, i + DELETE_CHUNK);
        await tx.run(
          `DELETE FROM tour_records WHERE area_id = ? AND tour_id IN (${ids.map(() => '?').join(',')})`,
          [areaId, ...ids],
        );
      }
      await tx.run(
        `INSERT INTO tour_sync_state (area_id, lang, dataset_version, synced_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (area_id, lang) DO UPDATE SET
           dataset_version = excluded.dataset_version, synced_at = excluded.synced_at`,
        [areaId, lang, page.datasetVersion, input.now()],
      );
    });
    written += records.length;
    cursor = page.datasetVersion;
    if (page.complete) break;
  }
  return written;
}
