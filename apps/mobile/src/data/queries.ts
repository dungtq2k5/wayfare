import type { PlaceSyncRecord } from '@wayfare/contracts';
import type { Database } from '../db/database';

/** One synced area: how much of it the phone holds, and how current. */
export interface AreaSummary {
  readonly areaId: string;
  readonly places: number;
  readonly datasetVersion: number;
  /** When the last change was applied (a `304` writes nothing, so it does not move this). */
  readonly syncedAt: number;
}

/** Every area the phone has synced in `lang`, with its Place count. */
export async function areaSummaries(db: Database, lang: string): Promise<AreaSummary[]> {
  const rows = await db.all<{
    area_id: string;
    places: number;
    dataset_version: number;
    synced_at: number;
  }>(
    `SELECT s.area_id, s.dataset_version, s.synced_at,
            (SELECT COUNT(*) FROM place_records p WHERE p.area_id = s.area_id AND p.lang = s.lang) AS places
       FROM sync_state s WHERE s.lang = ? ORDER BY s.area_id`,
    [lang],
  );
  return rows.map((row) => ({
    areaId: row.area_id,
    places: row.places,
    datasetVersion: row.dataset_version,
    syncedAt: row.synced_at,
  }));
}

/** An area's Places in `lang`, as the server sent them (validated on the way in). */
export async function placesOfArea(
  db: Database,
  areaId: string,
  lang: string,
): Promise<PlaceSyncRecord[]> {
  const rows = await db.all<{ record_json: string }>(
    'SELECT record_json FROM place_records WHERE area_id = ? AND lang = ? ORDER BY place_id',
    [areaId, lang],
  );
  return rows.map((row) => JSON.parse(row.record_json) as PlaceSyncRecord);
}

/** Every synced Place of every area in `lang`: what the map draws and Explore lists offline. */
export async function allPlaces(db: Database, lang: string): Promise<PlaceSyncRecord[]> {
  const rows = await db.all<{ record_json: string }>(
    'SELECT record_json FROM place_records WHERE lang = ? ORDER BY place_id',
    [lang],
  );
  return rows.map((row) => JSON.parse(row.record_json) as PlaceSyncRecord);
}

/** One synced Place, or null when this phone does not hold it. */
export async function placeById(
  db: Database,
  placeId: string,
  lang: string,
): Promise<PlaceSyncRecord | null> {
  const [row] = await db.all<{ record_json: string }>(
    'SELECT record_json FROM place_records WHERE place_id = ? AND lang = ?',
    [placeId, lang],
  );
  return row === undefined ? null : (JSON.parse(row.record_json) as PlaceSyncRecord);
}
