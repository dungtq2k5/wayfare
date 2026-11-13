import type { Database, Queries } from '../db/database';
import type { FileKind, PackFile, PackMap } from './plan';
import { SHARED } from './plan';

/** A pack's state (the handoff's *Pack state* and *Pack progress*, one to one). */
export type PackState =
  | 'downloading'
  | 'paused'
  | 'waiting-connection'
  | 'waiting-wifi'
  | 'no-space'
  | 'checking'
  | 'ready'
  | 'update'
  | 'damaged'
  | 'failed';

/** The states whose files are used: a damaged pack only for its good files. */
export const USED_STATES: readonly PackState[] = ['ready', 'update', 'damaged'];
/** The states a download goes on from by itself, when the network and the space allow. */
export const RESUMABLE_STATES: readonly PackState[] = [
  'downloading',
  'waiting-connection',
  'waiting-wifi',
  'no-space',
  'checking',
];

/** An update found by the diff, as frame M3 shows it. */
export interface PackUpdate {
  readonly bytes: number;
  readonly changed: number;
  readonly added: number;
  readonly since: number;
}

export interface Pack {
  readonly areaId: string;
  readonly lang: string;
  readonly state: PackState;
  readonly datasetVersion: number;
  readonly mapPackVersion: number;
  readonly bytes: number;
  readonly wifiOnly: boolean;
  readonly installedAt: number | null;
  readonly updatedAt: number | null;
  readonly error: string | null;
  readonly update: PackUpdate | null;
  readonly map: PackMap | null;
}

interface PackRow {
  area_id: string;
  lang: string;
  state: PackState;
  dataset_version: number;
  map_pack_version: number;
  bytes: number;
  wifi_only: number;
  installed_at: number | null;
  updated_at: number | null;
  error: string | null;
  update_json: string | null;
  map_json: string | null;
}

interface FileRow {
  area_id: string;
  lang: string;
  kind: FileKind;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  place_id: string | null;
  verified: number;
}

const packOf = (row: PackRow): Pack => ({
  areaId: row.area_id,
  lang: row.lang,
  state: row.state,
  datasetVersion: row.dataset_version,
  mapPackVersion: row.map_pack_version,
  bytes: row.bytes,
  wifiOnly: row.wifi_only === 1,
  installedAt: row.installed_at,
  updatedAt: row.updated_at,
  error: row.error,
  update: row.update_json === null ? null : (JSON.parse(row.update_json) as PackUpdate),
  map: row.map_json === null ? null : (JSON.parse(row.map_json) as PackMap),
});

const fileOf = (row: FileRow): PackFile => ({
  areaId: row.area_id,
  lang: row.lang,
  kind: row.kind,
  name: row.name,
  url: row.url,
  sha256: row.sha256,
  bytes: row.bytes,
  placeId: row.place_id,
  verified: row.verified === 1,
});

export async function allPacks(db: Queries): Promise<Pack[]> {
  return (await db.all<PackRow>('SELECT * FROM packs ORDER BY area_id, lang')).map(packOf);
}

export async function packOfArea(db: Queries, areaId: string, lang: string): Promise<Pack | null> {
  const [row] = await db.all<PackRow>('SELECT * FROM packs WHERE area_id = ? AND lang = ?', [
    areaId,
    lang,
  ]);
  return row === undefined ? null : packOf(row);
}

export async function savePack(db: Queries, pack: Pack): Promise<void> {
  await db.run(
    `INSERT INTO packs (area_id, lang, state, dataset_version, map_pack_version, bytes, wifi_only,
       installed_at, updated_at, error, update_json, map_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (area_id, lang) DO UPDATE SET
       state = excluded.state, dataset_version = excluded.dataset_version,
       map_pack_version = excluded.map_pack_version, bytes = excluded.bytes,
       wifi_only = excluded.wifi_only, installed_at = excluded.installed_at,
       updated_at = excluded.updated_at, error = excluded.error,
       update_json = excluded.update_json, map_json = excluded.map_json`,
    [
      pack.areaId,
      pack.lang,
      pack.state,
      pack.datasetVersion,
      pack.mapPackVersion,
      pack.bytes,
      pack.wifiOnly ? 1 : 0,
      pack.installedAt,
      pack.updatedAt,
      pack.error,
      pack.update === null ? null : JSON.stringify(pack.update),
      pack.map === null ? null : JSON.stringify(pack.map),
    ],
  );
}

export async function setPackState(
  db: Queries,
  areaId: string,
  lang: string,
  state: PackState,
  error: string | null = null,
): Promise<void> {
  await db.run('UPDATE packs SET state = ?, error = ? WHERE area_id = ? AND lang = ?', [
    state,
    error,
    areaId,
    lang,
  ]);
}

/**
 * Adds a pack's file rows. A row already there keeps its `verified`: a shared photo, or a file an
 * earlier download or another language already holds, is not fetched again.
 */
export async function addFiles(db: Queries, files: readonly PackFile[]): Promise<void> {
  for (const file of files) {
    await db.run(
      `INSERT INTO pack_files (area_id, lang, kind, name, url, sha256, bytes, place_id, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (area_id, lang, kind, name) DO UPDATE SET url = excluded.url`,
      [
        file.areaId,
        file.lang,
        file.kind,
        file.name,
        file.url,
        file.sha256,
        file.bytes,
        file.placeId,
      ],
    );
  }
}

/**
 * A pack's files: its language's, and the files every pack of the area shares.
 * ponytail: a pack counts every shared file of its area, as each language lists the same Places;
 * a per-pack membership table if languages ever list different Places.
 */
export async function filesOfPack(db: Queries, areaId: string, lang: string): Promise<PackFile[]> {
  return (
    await db.all<FileRow>(
      'SELECT * FROM pack_files WHERE area_id = ? AND (lang = ? OR lang = ?) ORDER BY rowid',
      [areaId, lang, SHARED],
    )
  ).map(fileOf);
}

export async function setVerified(db: Queries, file: PackFile, verified: boolean): Promise<void> {
  await db.run(
    'UPDATE pack_files SET verified = ? WHERE area_id = ? AND lang = ? AND kind = ? AND name = ?',
    [verified ? 1 : 0, file.areaId, file.lang, file.kind, file.name],
  );
}

export async function deleteFileRows(db: Queries, files: readonly PackFile[]): Promise<void> {
  for (const file of files) {
    await db.run(
      'DELETE FROM pack_files WHERE area_id = ? AND lang = ? AND kind = ? AND name = ?',
      [file.areaId, file.lang, file.kind, file.name],
    );
  }
}

/** Every verified file of the packs in use, for the map, the photos and the player. */
export async function usedFiles(db: Queries): Promise<PackFile[]> {
  return (
    await db.all<FileRow>(
      `SELECT f.* FROM pack_files f
        WHERE f.verified = 1 AND EXISTS (
          SELECT 1 FROM packs p WHERE p.area_id = f.area_id
            AND (f.lang = '' OR p.lang = f.lang) AND p.state IN ('ready', 'update', 'damaged'))`,
    )
  ).map(fileOf);
}

export async function deletePackRow(db: Database | Queries, areaId: string, lang: string) {
  await db.run('DELETE FROM packs WHERE area_id = ? AND lang = ?', [areaId, lang]);
}
