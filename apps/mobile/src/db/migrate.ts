import type { Database } from './database';
import { migration0001 } from './migrations/0001_places';
import { migration0002 } from './migrations/0002_resync_for_address';

/** One numbered step. Once shipped, a migration is never edited (conventions §12.2). */
export interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

/** Every migration, oldest first. */
export const MIGRATIONS: readonly Migration[] = [migration0001, migration0002];

/** The schema version the database is at (`PRAGMA user_version`). */
export async function schemaVersion(db: Database): Promise<number> {
  const [row] = await db.all<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applies every migration newer than the database's version, each in one transaction together
 * with the version bump, so a failed step leaves the previous version intact.
 */
export async function migrate(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const current = await schemaVersion(db);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.run(statement);
      await tx.run(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
