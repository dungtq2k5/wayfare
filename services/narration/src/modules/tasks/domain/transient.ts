import { randomInt } from 'node:crypto';

/** Postgres's deadlock and serialization failure: the transaction was aborted, not wrong. */
const TRANSIENT_SQLSTATES = new Set(['40P01', '40001']);

/** A transaction is tried at most this many times when it fails transiently. */
export const TRANSACTION_TRIES = 3;

/**
 * Whether a transaction failed only because Postgres aborted it — a deadlock or a serialization
 * failure — or because it never started (no connection came within the pool's wait), so running it
 * again is right. Prisma reports an abort as `P2034` from a query it built, and as `P2010` (or
 * `P2039`) with the driver adapter's SQLSTATE from a raw query; a start that timed out as `P2028`.
 */
export function isTransientTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta, message } = error as { code?: unknown; meta?: unknown; message?: unknown };
  if (code === 'P2034') return true;
  // P2028 also covers a transaction that expired mid-way: only one that never began is retried.
  if (code === 'P2028') {
    return typeof message === 'string' && message.includes('Unable to start a transaction');
  }
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
