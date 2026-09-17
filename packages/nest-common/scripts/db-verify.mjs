#!/usr/bin/env node
// wayfare-db-verify — asserts that a service's working and _test databases have every migration
// it ships applied and every schema object in prisma/sql/expected-objects.json present
// (ADR 0045, rdm-spec §5). Run from a service directory; the queries are the ones `SchemaCheck`
// runs at boot.
//
// npm-script shells never load .env, so this script loads it itself.
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { migrationFolders, readExpectedObjects, schemaProblems } from '@wayfare/nest-common/schema';

const cwd = process.cwd();
loadEnv({ path: resolve(cwd, '.env'), quiet: true });

const expected = readExpectedObjects(resolve(cwd, 'prisma/sql/expected-objects.json'));
const migrations = migrationFolders(resolve(cwd, 'prisma/migrations'));

const targets = [
  ['working', process.env.DATABASE_URL],
  ['test', process.env.DATABASE_URL_TEST],
];

let failures = 0;
for (const [label, url] of targets) {
  if (!url) {
    console.error(`✗ ${label}: no database URL configured`);
    failures++;
    continue;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const problems = await schemaProblems(async (sql) => (await client.query(sql)).rows, {
      migrations,
      expected,
    });
    for (const problem of problems) console.error(`✗ ${label}: ${problem}`);
    failures += problems.length;
  } catch (error) {
    console.error(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    failures++;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (failures > 0) {
  console.error(`db:verify failed with ${failures} problem(s).`);
  process.exit(1);
}
const count = Object.values(expected).flat().length;
console.log(
  `✓ db:verify — ${migrations.length} migration(s) applied and ${count} object(s) present in the working and test databases.`,
);
