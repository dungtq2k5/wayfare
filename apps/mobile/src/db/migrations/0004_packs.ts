import type { Migration } from '../migrate';

/**
 * Offline packs: one row per downloaded area and language, and one per file. Map files and photos
 * carry `lang = ''`: they are the same in every language of the area, so they are shared.
 */
export const migration0004: Migration = {
  version: 4,
  statements: [
    `CREATE TABLE packs (
       area_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       state TEXT NOT NULL,
       dataset_version INTEGER NOT NULL,
       map_pack_version INTEGER NOT NULL,
       bytes INTEGER NOT NULL,
       wifi_only INTEGER NOT NULL,
       installed_at INTEGER,
       updated_at INTEGER,
       error TEXT,
       update_json TEXT,
       map_json TEXT,
       PRIMARY KEY (area_id, lang)
     )`,
    `CREATE TABLE pack_files (
       area_id TEXT NOT NULL,
       lang TEXT NOT NULL,
       kind TEXT NOT NULL,
       name TEXT NOT NULL,
       url TEXT NOT NULL,
       sha256 TEXT NOT NULL,
       bytes INTEGER NOT NULL,
       place_id TEXT,
       verified INTEGER NOT NULL,
       PRIMARY KEY (area_id, lang, kind, name)
     )`,
  ],
};
