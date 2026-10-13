import type { Database } from '../db/database';
import { initialWalk } from './machine';
import type { WalkRecord } from './machine';

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

export async function saveWalk(db: Database, walk: WalkRecord): Promise<void> {
  await db.run(
    `INSERT INTO walk_record (id, record) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET record = excluded.record`,
    [JSON.stringify(walk)],
  );
}

/** The kept walk, or an idle one when none was saved or the saved one cannot be read. */
export async function loadWalk(db: Database): Promise<WalkRecord> {
  const [row] = await db.all<{ record: string }>('SELECT record FROM walk_record WHERE id = 1');
  if (!row) return initialWalk();
  try {
    return { ...initialWalk(), ...(JSON.parse(row.record) as Partial<WalkRecord>) };
  } catch {
    return initialWalk();
  }
}
