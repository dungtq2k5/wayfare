import type { Migration } from '../migrate';

/** The walk: the Places heard on this phone, and the one walk record with its engine state. */
export const migration0003: Migration = {
  version: 3,
  statements: [
    `CREATE TABLE heard_places (
       place_id TEXT PRIMARY KEY,
       first_heard_at INTEGER NOT NULL,
       last_heard_at INTEGER NOT NULL
     )`,
    `CREATE TABLE walk_record (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       record TEXT NOT NULL
     )`,
  ],
};
