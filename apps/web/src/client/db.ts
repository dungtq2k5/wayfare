'use client';

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { DeviceCredentials } from '../session/web-session';

/** A Place opened on this browser (K11): WM5b and WO2b list them offline. */
export interface OpenedPlace {
  readonly code: string;
  readonly placeId: string;
  readonly name: string;
  readonly categoryCode: string;
  readonly areaCode: string;
  readonly photoUrl: string | null;
  readonly openedAt: number;
}

interface WayfareDb extends DBSchema {
  device: { key: 'credentials'; value: DeviceCredentials };
  opened: { key: string; value: OpenedPlace; indexes: { openedAt: number } };
  /** Per-browser counters and dates: saves made, prompts shown (K9, K13). */
  kv: { key: string; value: number | string | boolean };
}

let db: Promise<IDBPDatabase<WayfareDb>> | null = null;

/** The browser's one database, opened once. */
export function database(): Promise<IDBPDatabase<WayfareDb>> {
  db ??= openDB<WayfareDb>('wayfare', 1, {
    upgrade(next) {
      next.createObjectStore('device');
      next.createObjectStore('opened', { keyPath: 'code' }).createIndex('openedAt', 'openedAt');
      next.createObjectStore('kv');
    },
  });
  return db;
}

/** A per-browser value, or `fallback` when unset or the database is unavailable. */
export async function readKv<T extends number | string | boolean>(
  key: string,
  fallback: T,
): Promise<T> {
  try {
    return ((await (await database()).get('kv', key)) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writeKv(key: string, value: number | string | boolean): Promise<void> {
  try {
    await (await database()).put('kv', value, key);
  } catch {
    // A private window without IndexedDB: the value lasts this page only.
  }
}
