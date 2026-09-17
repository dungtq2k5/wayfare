import { Injectable } from '@nestjs/common';
import { SYNC_PAGE_SIZE, SYNC_SAFETY_LAG_MS } from '@wayfare/contracts';
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

/** One changed Place in a sync page. */
export interface SyncChange {
  readonly id: string;
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
   * The highest settled version, never below `since`: one number across every area. A row is
   * settled once its version is older than the lag, which no bumping transaction outlives.
   */
  async cap(since: bigint = 0n): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<{ cap: bigint }[]>`
      SELECT GREATEST(COALESCE(MAX(sync_version), 0), ${since}::bigint) AS cap
      FROM places
      WHERE updated_at < clock_timestamp() - make_interval(secs => ${SYNC_SAFETY_LAG_MS / 1000})`;
    return row?.cap ?? since;
  }

  /**
   * Every Place with `since < sync_version <= cap`, in version order, across **all** areas — a
   * Place that left the area is a removal there. A full page ends at its last version.
   */
  async changes(input: {
    readonly areaId: string;
    readonly since: bigint;
    readonly pageSize?: number;
  }): Promise<SyncChanges> {
    const pageSize = input.pageSize ?? SYNC_PAGE_SIZE;
    const cap = await this.cap(input.since);
    const rows = await this.prisma.$queryRaw<SyncChange[]>`
      SELECT id,
             sync_version AS "syncVersion",
             (status = 'ACTIVE' AND deleted_at IS NULL AND area_id = ${input.areaId}::uuid) AS live
      FROM places
      WHERE sync_version > ${input.since}::bigint AND sync_version <= ${cap}::bigint
      ORDER BY sync_version
      LIMIT ${pageSize + 1}`;
    if (rows.length > pageSize) {
      const page = rows.slice(0, pageSize);
      return { changes: page, datasetVersion: page.at(-1)!.syncVersion, complete: false };
    }
    return { changes: rows, datasetVersion: cap, complete: true };
  }
}
