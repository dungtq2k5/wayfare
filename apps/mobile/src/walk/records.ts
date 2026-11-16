import type { Database } from '../db/database';
import { initialWalk } from './machine';
import type { WalkRecord } from './machine';

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
