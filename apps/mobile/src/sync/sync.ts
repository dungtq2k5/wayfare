import { zPlaceSyncRecordStored } from '@wayfare/contracts';
import type { PlaceSyncRecord } from '@wayfare/contracts';
import type { Database } from '../db/database';

/** One page as the sync reads it from the wire. */
export interface SyncPage {
  readonly places: readonly unknown[];
  readonly removedPlaceIds: readonly string[];
  readonly datasetVersion: number;
  readonly complete: boolean;
}

export interface SyncClient {
  /** `undefined` is a `304`: nothing changed since `ifNoneMatch`. */
  places(request: {
    areaId: string;
    lang: string;
    since: number | undefined;
    ifNoneMatch: string | undefined;
  }): Promise<SyncPage | undefined>;
}

/**
 * The `ETag` the gateway sends for a sync page: `"<areaId>:<lang>:<datasetVersion>"`, quoted,
 * with the normalized language tag (api-endpoints-plan §2.1). Rebuilt here from the cursor, since a
 * body-only client never sees the header.
 */
export function syncTag(areaId: string, lang: string, datasetVersion: number): string {
  return `"${areaId}:${lang}:${datasetVersion}"`;
}

/** What one area's sync did. */
export interface AreaSyncResult {
  readonly areaId: string;
  readonly pages: number;
  readonly written: number;
  readonly removed: number;
  /** True when the first request answered `304`. */
  readonly unchanged: boolean;
  readonly datasetVersion: number | null;
}

const DELETE_CHUNK = 500;

/** The version this area was last synced to, in this language. */
export async function cursorOf(db: Database, areaId: string, lang: string): Promise<number | null> {
  const [row] = await db.all<{ dataset_version: number }>(
    'SELECT dataset_version FROM sync_state WHERE area_id = ? AND lang = ?',
    [areaId, lang],
  );
  return row?.dataset_version ?? null;
}

/**
 * Brings one area up to date: pages from the stored version until `complete`, each page in one
 * transaction — its records, its removals and the new cursor commit together, or not at all, so
 * a crash between pages is a resumable state.
 *
 * A removal deletes only this area's rows. The server lists as "removed" every Place that changed
 * and is not live **in this area**, including Places that changed only in another area; the
 * area qualifier is what keeps those safe.
 */
export async function syncArea(input: {
  db: Database;
  client: SyncClient;
  areaId: string;
  lang: string;
  now: () => number;
}): Promise<AreaSyncResult> {
  const { db, client, areaId, lang } = input;
  let cursor = await cursorOf(db, areaId, lang);
  let pages = 0;
  let written = 0;
  let removed = 0;
  let unchanged = false;
  for (;;) {
    const page = await client.places({
      areaId,
      lang,
      since: cursor ?? undefined,
      ifNoneMatch: cursor === null ? undefined : syncTag(areaId, lang, cursor),
    });
    if (page === undefined) {
      unchanged = pages === 0;
      break;
    }
    if (!page.complete && cursor !== null && page.datasetVersion <= cursor) {
      throw new Error(`Sync of ${areaId} is not advancing past ${cursor}`);
    }
    // Stored leniently, at every level: a field the server adds later is dropped, never rejected.
    const records = page.places.map((place) => zPlaceSyncRecordStored.parse(place));
    await db.transaction(async (tx) => {
      for (const record of records) await upsertRecord(tx, record, lang);
      for (let i = 0; i < page.removedPlaceIds.length; i += DELETE_CHUNK) {
        const ids = page.removedPlaceIds.slice(i, i + DELETE_CHUNK);
        await tx.run(
          `DELETE FROM place_records WHERE area_id = ? AND place_id IN (${ids.map(() => '?').join(',')})`,
          [areaId, ...ids],
        );
      }
      await tx.run(
        `INSERT INTO sync_state (area_id, lang, dataset_version, synced_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (area_id, lang) DO UPDATE SET
           dataset_version = excluded.dataset_version, synced_at = excluded.synced_at`,
        [areaId, lang, page.datasetVersion, input.now()],
      );
    });
    pages += 1;
    written += records.length;
    removed += page.removedPlaceIds.length;
    cursor = page.datasetVersion;
    if (page.complete) break;
  }
  return { areaId, pages, written, removed, unchanged, datasetVersion: cursor };
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function upsertRecord(tx: Tx, record: PlaceSyncRecord, lang: string): Promise<void> {
  await tx.run(
    `INSERT INTO place_records
       (place_id, lang, area_id, kind, category_code, lat, lng, record_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (place_id, lang) DO UPDATE SET
       area_id = excluded.area_id, kind = excluded.kind, category_code = excluded.category_code,
       lat = excluded.lat, lng = excluded.lng, record_json = excluded.record_json`,
    [
      record.id,
      lang,
      record.areaId,
      record.kind,
      record.categoryCode,
      record.location.lat,
      record.location.lng,
      JSON.stringify(record),
    ],
  );
}

/** Drops the rows and cursors of areas that are no longer active. */
export async function dropInactiveAreas(
  db: Database,
  activeAreaIds: readonly string[],
): Promise<void> {
  const marks = activeAreaIds.map(() => '?').join(',');
  const where = activeAreaIds.length === 0 ? '' : `WHERE area_id NOT IN (${marks})`;
  await db.transaction(async (tx) => {
    await tx.run(`DELETE FROM place_records ${where}`, [...activeAreaIds]);
    await tx.run(`DELETE FROM sync_state ${where}`, [...activeAreaIds]);
  });
}

/** Every active area, one after another, in the content language. */
export async function syncAreas(input: {
  db: Database;
  client: SyncClient;
  areaIds: readonly string[];
  lang: string;
  now: () => number;
}): Promise<AreaSyncResult[]> {
  // ponytail: every active area. At city scale, sync the area the tourist is in and its
  // neighbours instead, which needs a position (the walking loop).
  await dropInactiveAreas(input.db, input.areaIds);
  const results: AreaSyncResult[] = [];
  for (const areaId of input.areaIds) results.push(await syncArea({ ...input, areaId }));
  return results;
}

/** Wraps a task so a call made while one runs gets that run's promise, and starts no second pass. */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= task().finally(() => {
      running = null;
    });
    return running;
  };
}

/** The wipe behind *Forget this install*. */
export async function clearLocalData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM place_records');
    await tx.run('DELETE FROM sync_state');
  });
}
