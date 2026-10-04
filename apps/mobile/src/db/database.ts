import * as SQLite from 'expo-sqlite';

/** What a statement binds. */
export type SqlValue = string | number | null;

/** The two calls a statement needs, inside or outside a transaction. */
export interface Queries {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/**
 * The database as the app's code sees it: `expo-sqlite` on the phone, `node:sqlite` in specs, so
 * migrations and sync run against real SQLite without a device (conventions §12.2).
 */
export interface Database extends Queries {
  /** `fn` and everything it runs commit together, or not at all. */
  transaction<T>(fn: (tx: Queries) => Promise<T>): Promise<T>;
}

const DATABASE_NAME = 'wayfare.db';

function over(source: Pick<SQLite.SQLiteDatabase, 'runAsync' | 'getAllAsync'>): Queries {
  return {
    run: async (sql, params = []) => {
      await source.runAsync(sql, [...params]);
    },
    all: (sql, params = []) => source.getAllAsync(sql, [...params]),
  };
}

let opened: Promise<Database> | undefined;

/** The app's one database, opened once. */
export function openDatabase(): Promise<Database> {
  opened ??= SQLite.openDatabaseAsync(DATABASE_NAME).then((db) => ({
    ...over(db),
    async transaction(fn) {
      let result: Awaited<ReturnType<typeof fn>> | undefined;
      await db.withExclusiveTransactionAsync(async (txn) => {
        result = await fn(over(txn));
      });
      return result as Awaited<ReturnType<typeof fn>>;
    },
  }));
  return opened;
}
