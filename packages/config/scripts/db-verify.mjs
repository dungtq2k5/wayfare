#!/usr/bin/env node
// wayfare-db-verify — asserts every schema object a service declares in
// prisma/sql/expected-objects.json exists in BOTH its working and _test databases
// (ADR 0045, rdm-spec §5). Run from a service directory.
//
// npm-script shells never load .env, so this script loads it itself.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const expectedPath = resolve(process.cwd(), 'prisma/sql/expected-objects.json');
/** @type {{ indexes?: string[], constraints?: string[], extensions?: string[], sequences?: string[] }} */
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));

const targets = [
  ['working', process.env.DATABASE_URL],
  ['test', process.env.DATABASE_URL_TEST],
];

const SINGULAR = {
  indexes: 'index',
  constraints: 'constraint',
  extensions: 'extension',
  sequences: 'sequence',
};

const QUERIES = {
  indexes: `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'`,
  constraints: `SELECT conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
  extensions: `SELECT extname AS name FROM pg_extension`,
  sequences: `SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'`,
};

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
    for (const [kind, sql] of Object.entries(QUERIES)) {
      const wanted = expected[kind] ?? [];
      if (wanted.length === 0) continue;
      const { rows } = await client.query(sql);
      const present = new Set(rows.map((r) => r.name));
      for (const name of wanted) {
        if (!present.has(name)) {
          console.error(`✗ ${label}: missing ${SINGULAR[kind]} "${name}"`);
          failures++;
        }
      }
    }
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
console.log(`✓ db:verify — ${count} object(s) present in the working and test databases.`);
