import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DatabaseNotMigratedError,
  migrationFolders,
  missingSchemaObjects,
  schemaProblems,
  unappliedMigrations,
} from './schema-expectations';
import type { SqlQuery } from './schema-expectations';

/** A database described by what its catalogue queries would return. */
function fakeDatabase(state: {
  migrated?: boolean;
  applied?: string[];
  indexes?: string[];
  constraints?: string[];
  extensions?: string[];
  sequences?: string[];
}): SqlQuery {
  const rows = (names: string[] = []) => names.map((name) => ({ name }));
  return (sql) => {
    if (sql.includes('to_regclass'))
      return Promise.resolve([
        { name: state.migrated === false ? (null as never) : '_prisma_migrations' },
      ]);
    if (sql.includes('_prisma_migrations')) return Promise.resolve(rows(state.applied));
    if (sql.includes('pg_indexes')) return Promise.resolve(rows(state.indexes));
    if (sql.includes('pg_constraint')) return Promise.resolve(rows(state.constraints));
    if (sql.includes('pg_extension')) return Promise.resolve(rows(state.extensions));
    if (sql.includes('pg_sequences')) return Promise.resolve(rows(state.sequences));
    return Promise.reject(new Error(`unexpected query: ${sql}`));
  };
}

describe('missingSchemaObjects', () => {
  it('names every missing object by kind, and nothing when complete', async () => {
    const db = fakeDatabase({ indexes: ['a_idx'], constraints: ['b_ck'], extensions: ['postgis'] });
    await expect(
      missingSchemaObjects(db, {
        indexes: ['a_idx', 'gone_idx'],
        constraints: ['b_ck'],
        extensions: ['postgis'],
        sequences: ['seq'],
      }),
    ).resolves.toEqual(['index "gone_idx"', 'sequence "seq"']);
    await expect(missingSchemaObjects(db, { indexes: ['a_idx'] })).resolves.toEqual([]);
  });

  it('runs no query for a kind with nothing expected', async () => {
    const db: SqlQuery = () => Promise.reject(new Error('no query expected'));
    await expect(missingSchemaObjects(db, { indexes: [] })).resolves.toEqual([]);
  });
});

describe('unappliedMigrations', () => {
  it('lists the shipped folders not finished in the database', async () => {
    const db = fakeDatabase({ applied: ['20260101000000_init'] });
    await expect(
      unappliedMigrations(db, ['20260101000000_init', '20260202000000_next']),
    ).resolves.toEqual(['20260202000000_next']);
  });

  it('throws "not migrated" when the migrations table is absent', async () => {
    const db = fakeDatabase({ migrated: false });
    await expect(unappliedMigrations(db, [])).rejects.toBeInstanceOf(DatabaseNotMigratedError);
  });
});

describe('schemaProblems', () => {
  it('reports migrations first, then objects', async () => {
    const db = fakeDatabase({ applied: [], indexes: [] });
    await expect(
      schemaProblems(db, { migrations: ['20260101000000_init'], expected: { indexes: ['x'] } }),
    ).resolves.toEqual(['migration "20260101000000_init" not applied', 'index "x"']);
  });

  it('reports an unmigrated database as one problem', async () => {
    await expect(
      schemaProblems(fakeDatabase({ migrated: false }), {
        migrations: ['20260101000000_init'],
        expected: { indexes: ['x'] },
      }),
    ).resolves.toEqual(['not migrated — run pnpm db:deploy']);
  });
});

describe('migrationFolders', () => {
  it('lists only timestamped folders, in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    for (const name of ['20260202000000_b', '20260101000000_a', 'not_a_migration'])
      mkdirSync(join(dir, name));
    writeFileSync(join(dir, 'migration_lock.toml'), '');
    expect(migrationFolders(dir)).toEqual(['20260101000000_a', '20260202000000_b']);
  });
});
