import { Injectable } from '@nestjs/common';
import { LocalizationTargetType, SYNC_PAGE_SIZE, SYNC_SAFETY_LAG_MS } from '@wayfare/contracts';
import { contentRows } from '@wayfare/core';
import { rpcError } from '@wayfare/nest-common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A catalog transaction. */
export type CatalogTx = Prisma.TransactionClient;

/**
 * Prisma's own limit on a bumping transaction — below the server's, so an overrun normally rolls
 * back politely (rdm-spec §1.7).
 */
export const SYNC_WRITE_CLIENT_TIMEOUT_MS = 3_500;

/** The server's limit, the backstop: a transaction past it loses its connection. */
export const SYNC_WRITE_SERVER_TIMEOUT = '4s';

const LOST_TRANSACTION_CODES = new Set(['P1001', 'P1017', 'P2028']);
const LOST_CONNECTION_MESSAGE =
  /transaction timeout|terminating connection|Connection terminated|connection error|connection is closed|Transaction already closed/i;

/** True for a transaction that ended under us: a timeout, or a connection the server closed. */
export function isLostTransaction(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String(error.code) : '';
  if (LOST_TRANSACTION_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return LOST_CONNECTION_MESSAGE.test(message);
}

/**
 * Runs `fn` in a transaction that cannot outlive the sync safety lag (rdm-spec §1.7): the server
 * timeout is its **first** statement — Postgres starts that timer at the `SET` — and Prisma's
 * lower timeout ends it first. A transaction that ended under us is a retryable `503`. Every write
 * that bumps a `sync_version` goes through here, and bumps last.
 */
export async function withSyncWrite<T>(
  prisma: PrismaService,
  fn: (tx: CatalogTx) => Promise<T>,
  options: { readonly clientTimeoutMs?: number } = {},
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL transaction_timeout = '${SYNC_WRITE_SERVER_TIMEOUT}'`,
        );
        return fn(tx);
      },
      { timeout: options.clientTimeoutMs ?? SYNC_WRITE_CLIENT_TIMEOUT_MS },
    );
  } catch (error) {
    if (isLostTransaction(error)) throw rpcError('UPSTREAM_UNAVAILABLE');
    throw error;
  }
}

/**
 * Takes a Place's next `sync_version` (rdm-spec §1.7) — the **last** write of every transaction
 * that changes something a tourist could observe, the Place's own columns or its children's.
 * `updated_at` is the moment the version is taken (`clock_timestamp()`), not the transaction's
 * start: a version taken late in a long transaction is then still inside the lag window, so no
 * settled row can carry a version above one still uncommitted.
 */
export async function bumpSyncVersion(tx: CatalogTx, placeId: string): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ sync_version: bigint }[]>`
    UPDATE places
    SET sync_version = nextval('catalog_sync_version_seq'), updated_at = clock_timestamp()
    WHERE id = ${placeId}::uuid
    RETURNING sync_version`;
  if (row === undefined) throw new Error(`bumpSyncVersion: no Place ${placeId}`);
  return row.sync_version;
}

/** A tour's next `sync_version`, from the Places' sequence, taken last as a Place's is. */
export async function bumpTourSyncVersion(tx: CatalogTx, tourId: string): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ sync_version: bigint }[]>`
    UPDATE tours
    SET sync_version = nextval('catalog_sync_version_seq'), updated_at = clock_timestamp()
    WHERE id = ${tourId}::uuid
    RETURNING sync_version`;
  if (row === undefined) throw new Error(`bumpTourSyncVersion: no tour ${tourId}`);
  return row.sync_version;
}

/** The localization tables a version is stamped on, and the column naming their parent. */
const LOCALIZATION_TABLES = {
  [LocalizationTargetType.PLACE]: { table: 'place_localizations', parent: 'place_id' },
  [LocalizationTargetType.MENU_ITEM]: { table: 'menu_item_localizations', parent: 'menu_item_id' },
  [LocalizationTargetType.TOUR]: { table: 'tour_localizations', parent: 'tour_id' },
} as const;

/**
 * Takes a localization's next `sync_version` (rdm-spec §1.7) — the last write of its transaction,
 * as a Place's bump is (when a transaction also bumps the Place or tour, this comes first, then the
 * bump). `updated_at` is the database's clock at that moment: the only writer of the column.
 */
export async function stampLocalizationVersion(
  tx: CatalogTx,
  targetType: keyof typeof LOCALIZATION_TABLES,
  targetId: string,
  lang: string,
): Promise<bigint> {
  const { table, parent } = LOCALIZATION_TABLES[targetType];
  const [row] = await tx.$queryRaw<{ sync_version: bigint }[]>`
    UPDATE ${Prisma.raw(table)}
    SET sync_version = nextval('catalog_sync_version_seq'), updated_at = clock_timestamp()
    WHERE ${Prisma.raw(parent)} = ${targetId}::uuid AND lang = ${lang}
    RETURNING sync_version`;
  if (row === undefined) {
    throw new Error(`stampLocalizationVersion: no ${targetType} ${targetId} in ${lang}`);
  }
  return row.sync_version;
}

/** A versioned table and its localizations, as `changes` reads them. */
interface VersionedSource {
  readonly table: string;
  readonly localizations: string;
  readonly parent: string;
}
const PLACES: VersionedSource = {
  table: 'places',
  localizations: 'place_localizations',
  parent: 'place_id',
};
const TOURS: VersionedSource = {
  table: 'tours',
  localizations: 'tour_localizations',
  parent: 'tour_id',
};

/**
 * A row's version for a language (rdm-spec §1.7), over `t` and its localization joins `o` (the
 * language's own row) and `f` (the one the content chain falls back to): the greatest of its own
 * version and the served row's — counting only versions at or below the cap.
 */
function languageVersion(cap: bigint): Prisma.Sql {
  const counted = (column: Prisma.Sql) =>
    Prisma.sql`CASE WHEN ${column} <= ${cap}::bigint THEN ${column} ELSE 0 END`;
  return Prisma.sql`GREATEST(
    ${counted(Prisma.sql`t.sync_version`)},
    CASE WHEN o.lang IS NOT NULL THEN ${counted(Prisma.sql`o.sync_version`)}
         WHEN f.lang IS NOT NULL THEN ${counted(Prisma.sql`f.sync_version`)}
         ELSE 0 END)`;
}

/** The joins `languageVersion` reads: `o`, the language's own row, and `f`, its fallback's. */
function languageJoins(source: VersionedSource, lang: string | null): Prisma.Sql {
  const { own, fallback } = contentRows(lang);
  const localizations = Prisma.raw(source.localizations);
  const parent = Prisma.raw(source.parent);
  return Prisma.sql`
    LEFT JOIN ${localizations} o ON o.${parent} = t.id AND o.lang = ${own}
    LEFT JOIN ${localizations} f ON f.${parent} = t.id AND f.lang = ${fallback ?? own}
                                 AND ${fallback !== null}`;
}

/** One changed Place in a sync page. */
export interface SyncChange {
  readonly id: string;
  /** Its version for the page's language (`changes`). */
  readonly syncVersion: bigint;
  /** Active, not deleted, and in the requested area — served in full; else removed. */
  readonly live: boolean;
}

/** One page of changes. */
export interface SyncChanges {
  readonly changes: readonly SyncChange[];
  readonly datasetVersion: bigint;
  readonly complete: boolean;
}

/** The delta-sync read (rdm-spec §1.7, api-endpoints-plan §2.1). */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The highest settled version, never below `since`: one number across every area and language.
   * A row is settled once its version is older than the lag, which no bumping transaction outlives.
   * Over the four tables a sync reads — Places, tours and their localizations; menu translations
   * would move the cursor past nothing — each probed down its `sync_version` index to its newest
   * settled row, since every sync request asks.
   */
  async cap(since: bigint = 0n): Promise<bigint> {
    const settled = (table: string) => Prisma.sql`
      COALESCE((SELECT sync_version FROM ${Prisma.raw(table)}
                WHERE updated_at < bounds.settled ORDER BY sync_version DESC LIMIT 1), 0)`;
    const [row] = await this.prisma.$queryRaw<{ cap: bigint }[]>`
      SELECT GREATEST(${settled('places')}, ${settled('tours')},
                      ${settled('place_localizations')}, ${settled('tour_localizations')},
                      ${since}::bigint) AS cap
      FROM (SELECT clock_timestamp() - make_interval(secs => ${SYNC_SAFETY_LAG_MS / 1000})
              AS settled) bounds`;
    return row?.cap ?? since;
  }

  /**
   * The Places whose version for `lang` is above `since` and at or below the cap, in that order,
   * across **all** areas — a Place that left the area is a removal there. A full page ends at its
   * last version.
   */
  changes(input: {
    readonly areaId: string;
    readonly since: bigint;
    /** The served language; null for one Wayfare doesn't serve (it reads English). */
    readonly lang: string | null;
    readonly pageSize?: number;
  }): Promise<SyncChanges> {
    return this.languageChanges(PLACES, input);
  }

  /** `changes` for tours: by their own version and their localizations', as Places are. */
  tourChanges(input: {
    readonly areaId: string;
    readonly since: bigint;
    readonly lang: string | null;
    readonly pageSize?: number;
  }): Promise<SyncChanges> {
    return this.languageChanges(TOURS, input);
  }

  /**
   * An area's Places for an offline snapshot in `lang` (api-endpoints-plan §2.4): the live ones whose
   * own version is settled, in their language's version order, and the area's greatest version for
   * the language — the snapshot's name, so another language's translation doesn't make a new one.
   */
  async areaSnapshot(input: {
    readonly areaId: string;
    readonly lang: string | null;
    readonly cap: bigint;
  }): Promise<{ readonly live: readonly string[]; readonly version: bigint }> {
    const rows = await this.prisma.$queryRaw<{ id: string; live: boolean; version: bigint }[]>`
      SELECT t.id,
             (t.status = 'ACTIVE' AND t.deleted_at IS NULL) AS live,
             ${languageVersion(input.cap)} AS version
      FROM places t
      ${languageJoins(PLACES, input.lang)}
      WHERE t.area_id = ${input.areaId}::uuid AND t.sync_version <= ${input.cap}::bigint
      ORDER BY version, t.id`;
    return {
      live: rows.filter((row) => row.live).map((row) => row.id),
      version: rows.reduce(
        (greatest, row) => (row.version > greatest ? row.version : greatest),
        0n,
      ),
    };
  }

  /**
   * A language's version of each row (rdm-spec §1.7): the greatest of its own version and the
   * version of the localization a record in that language is served from — its own row, or, with
   * none, the row the content chain falls back to (`contentRows`). Only versions at or below the cap
   * count: a newer one is the next delta's. Candidates come from the `sync_version` and
   * `(lang, sync_version)` indexes, then each one's version is worked out.
   */
  private async languageChanges(
    source: VersionedSource,
    input: {
      readonly areaId: string;
      readonly since: bigint;
      readonly lang: string | null;
      readonly pageSize?: number;
    },
  ): Promise<SyncChanges> {
    const pageSize = input.pageSize ?? SYNC_PAGE_SIZE;
    const cap = await this.cap(input.since);
    const { own, fallback } = contentRows(input.lang);
    const table = Prisma.raw(source.table);
    const changedRows = (lang: string) => Prisma.sql`
      UNION
      SELECT ${Prisma.raw(source.parent)} FROM ${Prisma.raw(source.localizations)}
      WHERE lang = ${lang} AND sync_version > ${input.since}::bigint
        AND sync_version <= ${cap}::bigint`;
    const rows = await this.prisma.$queryRaw<SyncChange[]>`
      WITH candidates AS (
        SELECT id FROM ${table}
        WHERE sync_version > ${input.since}::bigint AND sync_version <= ${cap}::bigint
        ${changedRows(own)}
        ${fallback === null ? Prisma.empty : changedRows(fallback)}
      ),
      versions AS (
        SELECT t.id,
               (t.status = 'ACTIVE' AND t.deleted_at IS NULL
                AND t.area_id = ${input.areaId}::uuid) AS live,
               ${languageVersion(cap)} AS version
        FROM candidates c
        JOIN ${table} t ON t.id = c.id
        ${languageJoins(source, input.lang)}
      )
      SELECT id, version AS "syncVersion", live
      FROM versions
      WHERE version > ${input.since}::bigint
      ORDER BY version
      LIMIT ${pageSize + 1}`;
    if (rows.length > pageSize) {
      const page = rows.slice(0, pageSize);
      return { changes: page, datasetVersion: page.at(-1)!.syncVersion, complete: false };
    }
    return { changes: rows, datasetVersion: cap, complete: true };
  }
}
