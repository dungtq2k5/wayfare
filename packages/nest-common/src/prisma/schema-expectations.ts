// The catalogue checks behind `wayfare-db-verify` and `createSchemaCheck` (ADR 0045). Node only,
// never Nest: the verify bin loads this file through `@wayfare/nest-common/schema`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareStrings } from '@wayfare/contracts';

/** Runs one read-only catalogue query; each row names one object. Prisma and `pg` both fit. */
export type SqlQuery = (sql: string) => Promise<readonly { name: string }[]>;

/** A service's `prisma/sql/expected-objects.json`. */
export interface ExpectedObjects {
  readonly indexes?: readonly string[];
  readonly constraints?: readonly string[];
  readonly extensions?: readonly string[];
  readonly sequences?: readonly string[];
}

const KINDS = {
  indexes: {
    label: 'index',
    sql: `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'`,
  },
  constraints: {
    label: 'constraint',
    sql: `SELECT conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
  },
  extensions: { label: 'extension', sql: `SELECT extname AS name FROM pg_extension` },
  sequences: {
    label: 'sequence',
    sql: `SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'`,
  },
} as const;

/** The expected objects a database lacks, as `index "name"`; empty when complete. */
export async function missingSchemaObjects(
  query: SqlQuery,
  expected: ExpectedObjects,
): Promise<string[]> {
  const missing: string[] = [];
  for (const [kind, { label, sql }] of Object.entries(KINDS) as [
    keyof ExpectedObjects,
    (typeof KINDS)[keyof typeof KINDS],
  ][]) {
    const wanted = expected[kind] ?? [];
    if (wanted.length === 0) continue;
    const present = new Set((await query(sql)).map((row) => row.name));
    for (const name of wanted) if (!present.has(name)) missing.push(`${label} "${name}"`);
  }
  return missing;
}

/** Thrown when a database has never been migrated: it has no `_prisma_migrations` table. */
export class DatabaseNotMigratedError extends Error {
  constructor() {
    super('not migrated — run pnpm db:deploy');
    this.name = 'DatabaseNotMigratedError';
  }
}

/** The migration folders that are not finished in `_prisma_migrations`. */
export async function unappliedMigrations(
  query: SqlQuery,
  folders: readonly string[],
): Promise<string[]> {
  const [table] = await query(`SELECT to_regclass('public._prisma_migrations')::text AS name`);
  if (table?.name === undefined || table.name === null) throw new DatabaseNotMigratedError();
  const applied = new Set(
    (
      await query(
        `SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )
    ).map((row) => row.name),
  );
  return folders.filter((folder) => !applied.has(folder));
}

/** The migration folders a service ships (`<14 digits>_<name>`), in order. */
export function migrationFolders(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .toSorted(compareStrings);
}

/** Reads a service's `expected-objects.json`. */
export function readExpectedObjects(path: string): ExpectedObjects {
  return JSON.parse(readFileSync(path, 'utf8')) as ExpectedObjects;
}

/** Every problem that keeps a database from serving: unapplied migrations, then missing objects. */
export async function schemaProblems(
  query: SqlQuery,
  options: { readonly migrations: readonly string[]; readonly expected: ExpectedObjects },
): Promise<string[]> {
  try {
    const unapplied = await unappliedMigrations(query, options.migrations);
    const missing = await missingSchemaObjects(query, options.expected);
    return [...unapplied.map((name) => `migration "${name}" not applied`), ...missing];
  } catch (error) {
    if (error instanceof DatabaseNotMigratedError) return [error.message];
    throw error;
  }
}

/** The nearest directory at or above `start` holding a `package.json` — a service's root. */
export function packageRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No package.json above ${start}`);
    dir = parent;
  }
  return dir;
}
