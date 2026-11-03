import { randomInt } from 'node:crypto';

/** Postgres's deadlock and serialization failure: the transaction was aborted, not wrong. */
const TRANSIENT_SQLSTATES = new Set(['40P01', '40001']);

/** A transaction is tried at most this many times when it fails transiently. */
export const TRANSACTION_TRIES = 3;

/**
 * Whether a transaction failed only because Postgres aborted it — a deadlock or a serialization
 * failure — so running it again is right. Prisma reports it as `P2034` from a query it built, and as
 * `P2010` (or `P2039`) with the driver adapter's SQLSTATE from a raw query.
 */
export function isTransientTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code === 'P2034') return true;
  if (code !== 'P2010' && code !== 'P2039') return false;
  const cause = (
    meta as { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } }
  )?.driverAdapterError?.cause;
  return (
    cause?.kind === 'TransactionWriteConflict' ||
    (typeof cause?.originalCode === 'string' && TRANSIENT_SQLSTATES.has(cause.originalCode))
  );
}

/** A short jittered pause before trying again: tens of milliseconds, a little longer each time. */
export function transientPauseMs(
  tried: number,
  random: () => number = () => randomInt(0, 1000) / 1000,
): number {
  return Math.round(20 * tried + random() * 30);
}
