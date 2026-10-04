/// <reference types="node" />
// Spec-only: `node:sqlite` behind the app's `Database` interface. The app itself has no Node
// types (they would clash with React Native's), so this one file carries the reference.
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { Database, Queries } from './database';

/** A fresh in-memory database. */
export function openTestDatabase(): Database & { close(): void } {
  const db = new DatabaseSync(':memory:');
  const queries: Queries = {
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
      return Promise.resolve();
    },
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      Promise.resolve(db.prepare(sql).all(...(params as SQLInputValue[])) as T[]),
  };
  return {
    ...queries,
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn(queries);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}
