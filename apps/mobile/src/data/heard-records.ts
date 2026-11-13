import type { Database } from '../db/database';

/** Records that a Place's narration started: the first time keeps `first_heard_at`. */
export async function recordHeard(db: Database, placeId: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO heard_places (place_id, first_heard_at, last_heard_at) VALUES (?, ?, ?)
     ON CONFLICT (place_id) DO UPDATE SET last_heard_at = excluded.last_heard_at`,
    [placeId, now, now],
  );
}

/** Every Place heard on this phone. */
export async function heardPlaceIds(db: Database): Promise<string[]> {
  const rows = await db.all<{ place_id: string }>('SELECT place_id FROM heard_places');
  return rows.map((row) => row.place_id);
}
