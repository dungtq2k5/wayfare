// What the stack's seed holds, read once by the screens' setup before it makes anyone: a list the
// frames draw keeps these rows and the spec's own (`only` in answers.ts), and a count is the seed's,
// so neither changes with what other specs made, before or after (conventions §12.8).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Actor } from '../support/stack';

/**
 * Written by the setup on a fresh stack, and kept by a run that reuses the stack
 * (`E2E_SCREENS_REUSE=1`, CI's shards in reverse): what the stack held before any spec. Gitignored.
 */
const SEED_FILE = resolve(__dirname, '.seed.json');

export interface SeedPlace {
  readonly id: string;
  readonly categoryCode: string;
  readonly areaId: string;
  readonly status: string;
  readonly deletedAt: string | null;
}

export interface Seed {
  readonly places: readonly SeedPlace[];
  /** Each list's row ids, by its name below. */
  readonly ids: Readonly<Record<keyof typeof LISTS, readonly string[]>>;
}

/** The page-numbered lists whose seed rows the frames keep. */
const LISTS = {
  users: '/admin/users',
  jobs: '/admin/narration/jobs',
  registrations: '/admin/owner-registrations',
  billingAccounts: '/admin/billing/accounts',
  tours: '/admin/tours',
  stripeEvents: '/admin/billing/events',
  submissions: '/admin/submissions',
  roles: '/admin/roles',
} as const;

/** Every row of a page-numbered list, page by page. */
async function everything<Row>(admin: Actor, path: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page++) {
    const join = path.includes('?') ? '&' : '?';
    const { data } = await admin.call<{ data: Row[] }>(
      'GET',
      `${path}${join}page=${page}&pageSize=100`,
    );
    rows.push(...data);
    if (data.length < 100) return rows;
  }
}

/** Reads the seed's records and writes them for the specs; a reused stack keeps the first read. */
export async function snapshotSeed(admin: Actor, reuse: boolean): Promise<void> {
  if (reuse && existsSync(SEED_FILE)) return;
  const places = await everything<SeedPlace>(admin, '/admin/places?includeDeleted=true');
  const ids = {} as Record<keyof typeof LISTS, string[]>;
  for (const [name, path] of Object.entries(LISTS) as [keyof typeof LISTS, string][]) {
    // The registrations' list shows one status at a time.
    const paths =
      name === 'registrations'
        ? ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map(
            (status) => `${path}?status=${status}`,
          )
        : [path];
    ids[name] = [];
    for (const each of paths) {
      ids[name].push(...(await everything<{ id: string }>(admin, each)).map((row) => row.id));
    }
  }
  const seed: Seed = {
    places: places.map(({ id, categoryCode, areaId, status, deletedAt }) => ({
      id,
      categoryCode,
      areaId,
      status,
      deletedAt,
    })),
    ids,
  };
  writeFileSync(SEED_FILE, JSON.stringify(seed));
}

let read: Seed | undefined;

/** The seed, as the setup read it. */
export function seed(): Seed {
  read ??= JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed;
  return read;
}

/** Whether a row of a list came with the seed. */
export const seeded =
  (list: keyof typeof LISTS) =>
  (row: { id: string }): boolean =>
    seed().ids[list].includes(row.id);

/** How many of the seed's Places, not deleted, match. */
export const seedPlaces = (match: (place: SeedPlace) => boolean): number =>
  seed().places.filter((place) => place.deletedAt === null && match(place)).length;

/** Whether a Place came with the seed. */
export const seedPlace = (row: { id: string }): boolean =>
  seed().places.some((place) => place.id === row.id);
