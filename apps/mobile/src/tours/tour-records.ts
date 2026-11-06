import { tourDuration, tourProgress, tourStops } from '@wayfare/core';
import type { TourProgress } from '@wayfare/core';
import { zTourSyncRecordStored } from '@wayfare/contracts';
import type { Language, PlaceSyncRecordStored, TourSyncRecordStored } from '@wayfare/contracts';
import type { Database, Queries } from '../db/database';

/** A stop as the phone shows it: its position, its Place while live, the leg from the stop before. */
export interface LocalStop {
  readonly position: number;
  readonly place: PlaceSyncRecordStored | null;
  readonly legM: number;
}

/** A tour as the phone shows it, its live stops decided from the phone's own Places (K7). */
export interface LocalTour {
  readonly record: TourSyncRecordStored;
  readonly stops: readonly LocalStop[];
  readonly liveCount: number;
}

/**
 * Joins a tour to the phone's Places in its area — the server's rule, from the same core functions:
 * a stop is live while its Place is synced live there; a gap keeps its position.
 */
export function localTour(
  record: TourSyncRecordStored,
  places: ReadonlyMap<string, PlaceSyncRecordStored>,
): LocalTour {
  const legs = tourStops(
    record.stops.map((stop) => {
      const place = places.get(stop.placeId);
      return {
        position: stop.position,
        live: place === undefined || place.areaId !== record.areaId ? null : place.location,
      };
    }),
  );
  const stops = legs.map((leg, index) => ({
    position: leg.position,
    place: leg.live ? (places.get(record.stops[index]!.placeId) ?? null) : null,
    legM: leg.legM,
  }));
  return { record, stops, liveCount: stops.filter((stop) => stop.place !== null).length };
}

export async function tourRecords(
  db: Queries,
  lang: Language,
  areaId?: string,
): Promise<TourSyncRecordStored[]> {
  const rows = await db.all<{ record_json: string }>(
    areaId === undefined
      ? 'SELECT record_json FROM tour_records WHERE lang = ? ORDER BY tour_id'
      : 'SELECT record_json FROM tour_records WHERE lang = ? AND area_id = ? ORDER BY tour_id',
    areaId === undefined ? [lang] : [lang, areaId],
  );
  return rows.map((row) => zTourSyncRecordStored.parse(JSON.parse(row.record_json)));
}

/** Every story played to its end on this phone, by Place. */
export async function finishedStories(db: Queries): Promise<Map<string, number>> {
  const rows = await db.all<{ place_id: string; at: number }>(
    'SELECT place_id, at FROM stories_finished',
  );
  return new Map(rows.map((row) => [row.place_id, row.at]));
}

/** A story played to its end: the latest finish of its Place. */
export async function recordFinishedStory(db: Database, placeId: string, at: number) {
  await db.run(
    `INSERT INTO stories_finished (place_id, at) VALUES (?, ?)
     ON CONFLICT (place_id) DO UPDATE SET at = MAX(at, excluded.at)`,
    [placeId, at],
  );
}

export interface TourStart {
  readonly startedAt: number;
  readonly finishedSeenAt: number | null;
}

export async function tourStart(db: Queries, tourId: string): Promise<TourStart | null> {
  const [row] = await db.all<{ started_at: number; finished_seen_at: number | null }>(
    'SELECT started_at, finished_seen_at FROM tour_progress WHERE tour_id = ?',
    [tourId],
  );
  return row === undefined
    ? null
    : { startedAt: row.started_at, finishedSeenAt: row.finished_seen_at };
}

/** *Start this tour*: begins it once; *Walk it again* (`restart`) moves the start to now. */
export async function beginTour(db: Database, tourId: string, at: number, restart = false) {
  await db.run(
    restart
      ? `INSERT INTO tour_progress (tour_id, started_at) VALUES (?, ?)
         ON CONFLICT (tour_id) DO UPDATE SET started_at = excluded.started_at, finished_seen_at = NULL`
      : `INSERT INTO tour_progress (tour_id, started_at) VALUES (?, ?)
         ON CONFLICT (tour_id) DO NOTHING`,
    [tourId, at],
  );
}

/** The finished sheet was shown: once per finish. */
export async function markFinishedSeen(db: Database, tourId: string, at: number) {
  await db.run('UPDATE tour_progress SET finished_seen_at = ? WHERE tour_id = ?', [at, tourId]);
}

/** A tour's progress on this phone, and its time once finished. */
export function progressOf(
  tour: LocalTour,
  finished: ReadonlyMap<string, number>,
  start: TourStart | null,
): TourProgress & { readonly durationMs: number | null } {
  const stops = tour.stops.map((stop) => ({
    position: stop.position,
    placeId: stop.place?.id ?? null,
  }));
  const startedAt = start?.startedAt ?? null;
  return {
    ...tourProgress(stops, finished, startedAt),
    durationMs: tourDuration(stops, finished, startedAt),
  };
}
