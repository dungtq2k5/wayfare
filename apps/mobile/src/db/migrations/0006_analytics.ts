import type { Migration } from '../migrate';

/**
 * Analytics' queue: the consented events not yet sent, each under the analytics id it was recorded
 * with (ADR 0042) — validated, never a coordinate, at most a week old and 5,000 rows.
 */
export const migration0006: Migration = {
  version: 6,
  statements: [
    `CREATE TABLE analytics_events (
       id TEXT PRIMARY KEY,
       analytics_device_id TEXT NOT NULL,
       body TEXT NOT NULL,
       recorded_at INTEGER NOT NULL
     )`,
    'CREATE INDEX analytics_events_recorded ON analytics_events (recorded_at)',
  ],
};
