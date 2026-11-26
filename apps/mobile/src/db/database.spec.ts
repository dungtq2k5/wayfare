import { beforeEach, describe, expect, it, vi } from 'vitest';

/** expo-sqlite's database, as far as the app uses it. */
const sqlite = vi.hoisted(() => {
  const log: string[] = [];
  const queries = (who: string) => ({
    runAsync: vi.fn((sql: string, params: unknown[]) => {
      log.push(`${who} run ${sql} ${JSON.stringify(params)}`);
      return Promise.resolve();
    }),
    getAllAsync: vi.fn((sql: string, params: unknown[]) => {
      log.push(`${who} all ${sql} ${JSON.stringify(params)}`);
      return Promise.resolve([{ n: 1 }]);
    }),
  });
  const db = {
    ...queries('db'),
    execAsync: vi.fn((sql: string) => {
      log.push(`exec ${sql}`);
      return Promise.resolve();
    }),
    /** What the next transaction's BEGIN fails with, a time each. */
    locks: [] as Error[],
    withExclusiveTransactionAsync: vi.fn(async (fn: (txn: unknown) => Promise<void>) => {
      const lock = db.locks.shift();
      if (lock) throw lock;
      log.push('begin');
      await fn(queries('txn'));
      log.push('commit');
    }),
  };
  return { log, db, openDatabaseAsync: vi.fn(() => Promise.resolve(db)) };
});
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: sqlite.openDatabaseAsync }));

const { openDatabase } = await import('./database');

describe('the phone’s database', () => {
  beforeEach(() => {
    sqlite.log.length = 0;
  });

  it('opens once, and waits on another connection’s write rather than failing at once', async () => {
    const db = await openDatabase();
    expect(await openDatabase()).toBe(db);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith('wayfare.db');
    expect(sqlite.db.execAsync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
  });

  it('binds a statement’s values, none by default', async () => {
    const db = await openDatabase();
    await db.run('DELETE FROM kv');
    await db.run('DELETE FROM kv WHERE k = ?', ['a']);
    expect(await db.all('SELECT 1')).toEqual([{ n: 1 }]);
    expect(sqlite.log).toEqual([
      'db run DELETE FROM kv []',
      'db run DELETE FROM kv WHERE k = ? ["a"]',
      'db all SELECT 1 []',
    ]);
  });

  it('runs a transaction’s statements on its own connection, and answers its result', async () => {
    const db = await openDatabase();
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO kv VALUES (?)', [1]);
      return (await tx.all<{ n: number }>('SELECT n'))[0]!.n;
    });
    expect(result).toBe(1);
    expect(sqlite.log).toEqual([
      'begin',
      'txn run INSERT INTO kv VALUES (?) [1]',
      'txn all SELECT n []',
      'commit',
    ]);
  });

  it('runs transactions one at a time, in the order they were asked', async () => {
    const db = await openDatabase();
    await Promise.all([
      db.transaction((tx) => tx.run('first')),
      db.transaction((tx) => tx.run('second')),
    ]);
    expect(sqlite.log.filter((line) => line !== 'begin' && line !== 'commit')).toEqual([
      'txn run first []',
      'txn run second []',
    ]);
    expect(sqlite.log.indexOf('txn run second []')).toBeGreaterThan(sqlite.log.indexOf('commit'));
  });

  it('asks again for a lock another write holds, and a failed one never stops the next', async () => {
    vi.useFakeTimers();
    try {
      const db = await openDatabase();
      sqlite.db.locks.push(new Error('database is locked'));
      const retried = db.transaction((tx) => tx.run('after the lock'));
      await vi.advanceTimersByTimeAsync(1_000);
      await retried;
      expect(sqlite.log).toContain('txn run after the lock []');
      sqlite.db.locks.push(new Error('disk I/O error'));
      await expect(db.transaction((tx) => tx.run('never'))).rejects.toThrow('disk I/O error');
      await db.transaction((tx) => tx.run('next'));
      expect(sqlite.log).toContain('txn run next []');
    } finally {
      vi.useRealTimers();
    }
  });
});
