import type { Migration } from '../migrate';

/**
 * Tours (round 39): each area's synced tours in a language with their own cursor; the stories
 * played to their end on this phone; and each tour's start here — progress counts finishes since
 * it, and *Walk it again* moves it (K8). `finished_seen_at` keeps the finished sheet to once.
 */
export const migration0005: Migration = {
  version: 5,
  statements: [
    `CREATE TABLE tour_records (
       tour_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       area_id TEXT NOT NULL,
       record_json TEXT NOT NULL,
       PRIMARY KEY (tour_id, lang)
     )`,
    'CREATE INDEX tour_records_area_lang ON tour_records (area_id, lang)',
    `CREATE TABLE tour_sync_state (
       area_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       dataset_version INTEGER NOT NULL,
       synced_at INTEGER NOT NULL,
       PRIMARY KEY (area_id, lang)
     )`,
    `CREATE TABLE stories_finished (
       place_id TEXT PRIMARY KEY,
       at INTEGER NOT NULL
     )`,
    `CREATE TABLE tour_progress (
       tour_id TEXT PRIMARY KEY,
       started_at INTEGER NOT NULL,
       finished_seen_at INTEGER
     )`,
  ],
};
