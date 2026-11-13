import { describe, expect, it } from 'vitest';
import { isTransientTransactionError, transientPauseMs } from './transient';

const raw = (originalCode: string, code = 'P2010') => ({
  code,
  meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode } } },
});

describe('a transaction Postgres aborted', () => {
  it('is a deadlock or a serialization failure, however Prisma reports it', () => {
    expect(isTransientTransactionError({ code: 'P2034' })).toBe(true);
    expect(isTransientTransactionError(raw('40P01'))).toBe(true);
    expect(isTransientTransactionError(raw('40001'))).toBe(true);
    expect(isTransientTransactionError(raw('40P01', 'P2039'))).toBe(true);
    expect(
      isTransientTransactionError({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
      }),
    ).toBe(true);
  });

  it('is a transaction that never started, not one that expired', () => {
    const p2028 = (message: string) => ({ code: 'P2028', message });
    expect(
      isTransientTransactionError(
        p2028('Transaction API error: Unable to start a transaction in the given time.'),
      ),
    ).toBe(true);
    expect(
      isTransientTransactionError(
        p2028('Transaction API error: A commit cannot be executed on an expired transaction.'),
      ),
    ).toBe(false);
  });

  it('is nothing else', () => {
    expect(isTransientTransactionError(raw('23505'))).toBe(false);
    expect(isTransientTransactionError({ code: 'P2002' })).toBe(false);
    expect(isTransientTransactionError(new Error('deadlock detected'))).toBe(false);
    expect(isTransientTransactionError(null)).toBe(false);
  });

  it('waits tens of milliseconds, longer each try', () => {
    expect(transientPauseMs(1, () => 0)).toBe(20);
    expect(transientPauseMs(2, () => 1)).toBe(70);
  });
});
