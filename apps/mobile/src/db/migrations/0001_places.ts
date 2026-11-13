import type { Migration } from '../migrate';

/** The synced Places and each area's sync cursor. */
export const migration0001: Migration = {
  version: 1,
  statements: [
    `CREATE TABLE place_records (
       place_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       area_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       category_code TEXT NOT NULL,
       lat REAL NOT NULL,
       lng REAL NOT NULL,
       record_json TEXT NOT NULL,
       PRIMARY KEY (place_id, lang)
     )`,
    'CREATE INDEX place_records_area_lang ON place_records (area_id, lang)',
    `CREATE TABLE sync_state (
       area_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       dataset_version INTEGER NOT NULL,
       synced_at INTEGER NOT NULL,
       PRIMARY KEY (area_id, lang)
     )`,
  ],
};
