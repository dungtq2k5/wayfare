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

/** A story played to its end on this browser (round 39's K8): its Place and when. */
export interface FinishedStory {
  readonly placeId: string;
  readonly at: number;
}

/** A consented event not yet sent, under the analytics id it was recorded with (ADR 0042). */
export interface QueuedAnalyticsEvent {
  readonly id: string;
  readonly analyticsDeviceId: string;
  readonly body: string;
  readonly recordedAt: number;
}

interface WayfareDb extends DBSchema {
  /** Analytics' queue: validated events, never a coordinate, at most a week old and 5,000 rows. */
  analytics: {
    key: string;
    value: QueuedAnalyticsEvent;
    indexes: { recordedAt: number };
  };
  device: { key: 'credentials'; value: DeviceCredentials };
  /** The latest time each Place's story finished here: a tour's progress reads it. */
  finished: { key: string; value: FinishedStory };
  opened: { key: string; value: OpenedPlace; indexes: { openedAt: number } };
  /** Per-browser counters and dates: saves made, prompts shown (K9, K13). */
  kv: { key: string; value: number | string | boolean };
}

let db: Promise<IDBPDatabase<WayfareDb>> | null = null;

/** The browser's one database, opened once. */
export function database(): Promise<IDBPDatabase<WayfareDb>> {
  db ??= openDB<WayfareDb>('wayfare', 3, {
    upgrade(next, oldVersion) {
      if (oldVersion < 1) {
        next.createObjectStore('device');
        next.createObjectStore('opened', { keyPath: 'code' }).createIndex('openedAt', 'openedAt');
        next.createObjectStore('kv');
      }
      if (oldVersion < 2) next.createObjectStore('finished', { keyPath: 'placeId' });
      if (oldVersion < 3)
        next
          .createObjectStore('analytics', { keyPath: 'id' })
          .createIndex('recordedAt', 'recordedAt');
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
