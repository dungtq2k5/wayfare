import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, schemaVersion } from './migrate';
import type { Migration } from './migrate';
import { openTestDatabase } from './test-database';

/** Two invented later steps, so "from each intermediate version" is exercised. */
const LATER: Migration[] = [
  { version: 2, statements: ['ALTER TABLE sync_state ADD COLUMN note TEXT'] },
  { version: 3, statements: ['CREATE TABLE extra (id INTEGER PRIMARY KEY)'] },
];
const ALL = [...MIGRATIONS, ...LATER];

const tables = async (db: ReturnType<typeof openTestDatabase>) =>
  (
    await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
  ).map((row) => row.name);

describe('migrate', () => {
  it('numbers the shipped migrations 1..n with no gap', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it('applies the shipped migrations to an empty database', async () => {
    const db = openTestDatabase();
    await migrate(db);
    expect(await schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(await tables(db)).toEqual(expect.arrayContaining(['place_records', 'sync_state']));
  });

  it.each([0, 1, 2, 3])('reaches the last version from version %i', async (from) => {
    const db = openTestDatabase();
    await migrate(db, ALL.slice(0, from));
    await migrate(db, ALL);
    expect(await schemaVersion(db)).toBe(3);
    expect(await tables(db)).toContain('extra');
  });

  it('is a no-op when already current', async () => {
    const db = openTestDatabase();
    await migrate(db);
    await migrate(db);
    expect(await schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('leaves the previous version when a step fails', async () => {
    const db = openTestDatabase();
    await migrate(db);
    const broken: Migration = {
      version: 2,
      statements: ['CREATE TABLE half (id INTEGER)', 'THIS IS NOT SQL'],
    };
    await expect(migrate(db, [...MIGRATIONS, broken])).rejects.toThrow();
    expect(await schemaVersion(db)).toBe(1);
    expect(await tables(db)).not.toContain('half');
  });
});
