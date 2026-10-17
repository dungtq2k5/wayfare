import { ApiError, offlineDiff, offlineManifest } from '@wayfare/api-client';
import { create } from 'zustand';
import { databaseReady } from '../data/boot';
import { tourist } from '../i18n';
import { showToast } from '../ui/toast';
import { areaName } from './area-name';
import type { Pack, PackState } from './db';
import {
  addFiles,
  allPacks,
  deleteFileRows,
  deletePackRow,
  filesOfPack,
  packOfArea,
  RESUMABLE_STATES,
  savePack,
  setPackState,
} from './db';
import { runDownload } from './engine';
import type { Progress } from './engine';
import { engineDeps, networkKind } from './engine-deps';
import { areaFolder, packFile, packsRoot } from './files';
import { notifyPack } from './notify';
import { filesOf, filesToRemove, inOrder } from './plan';
import { resetPackSettings, usePackSettings } from './settings';
import { isEmptyDiff, updateSummary } from './updates';
import { refreshPackIndex } from './use-pack-files';

interface PackStore {
  packs: Pack[];
  /** Live progress of the downloads under way, by `packKey`. */
  progress: Record<string, Progress>;
  /** The bytes every verified pack file takes on the phone, each file once. */
  usedBytes: number;
}

export const usePackStore = create<PackStore>(() => ({ packs: [], progress: {}, usedBytes: 0 }));

export const packKey = (areaId: string, lang: string) => `${areaId}|${lang}`;

/**
 * Reads the packs again, each with where its download stands from its rows — so a paused or
 * relaunched download shows its bytes and stage before any file moves. Every screen follows.
 */
export async function refreshPacks(): Promise<void> {
  // Refreshes overlap (a read can wait behind an activation's transaction): only the latest one
  // writes, or an older read would put a finished pack back to *Checking*.
  const mine = (refreshes += 1);
  const db = await databaseReady;
  const packs = await allPacks(db);
  const standing: Record<string, Progress> = {};
  for (const pack of packs) {
    const files = await filesOfPack(db, pack.areaId, pack.lang);
    const next = inOrder(files.filter((file) => !file.verified))[0];
    standing[packKey(pack.areaId, pack.lang)] = {
      done: files.filter((file) => file.verified).reduce((sum, file) => sum + file.bytes, 0),
      total: files.reduce((sum, file) => sum + file.bytes, 0),
      stage: next?.kind ?? 'checking',
    };
  }
  const [used] = await db.all<{ bytes: number | null }>(
    'SELECT SUM(bytes) AS bytes FROM pack_files WHERE verified = 1',
  );
  if (mine !== refreshes) return;
  usePackStore.setState((state) => ({
    packs,
    progress: { ...standing, ...live(state.progress) },
    usedBytes: used?.bytes ?? 0,
  }));
}

/** The progress of the runs under way, which is fresher than the rows. */
const live = (progress: Record<string, Progress>) =>
  Object.fromEntries(Object.entries(progress).filter(([key]) => runs.has(key)));

const runs = new Map<string, { controller: AbortController; done: Promise<PackState> }>();
let refreshes = 0;

async function deps() {
  return engineDeps(await databaseReady, {
    changed: () => void refreshPacks(),
    progress: (areaId, lang, progress) => {
      usePackStore.setState((state) => ({
        progress: { ...state.progress, [packKey(areaId, lang)]: progress },
      }));
      notifyPack(areaId, lang, 'progress', progress);
    },
  });
}

/** What a run ended in, said once: frame D5's toast, and N1's last word. */
async function ended(areaId: string, lang: string, state: PackState): Promise<void> {
  await refreshPacks();
  if (state === 'ready') {
    await refreshPackIndex();
    showToast(tourist().t('pack.toast.ready', { area: areaName(areaId) }));
  }
  const bytes =
    usePackStore.getState().packs.find((p) => p.areaId === areaId && p.lang === lang)?.bytes ?? 0;
  notifyPack(areaId, lang, state, { done: bytes, total: bytes, stage: 'checking' });
}

/** Runs a pack's download; a second call while it runs joins it (frame D2: *Download* twice). */
export function runPack(areaId: string, lang: string): Promise<PackState> {
  const key = packKey(areaId, lang);
  const running = runs.get(key);
  if (running !== undefined) return running.done;
  const controller = new AbortController();
  const done = (async () => {
    try {
      const state = await runDownload(await deps(), areaId, lang, controller.signal);
      await ended(areaId, lang, state);
      return state;
    } finally {
      runs.delete(key);
    }
  })();
  runs.set(key, { controller, done });
  return done;
}

/** Ends a run where it is (a pause, a cancel, a delete) and waits for it to stop. */
async function halt(areaId: string, lang: string): Promise<void> {
  const running = runs.get(packKey(areaId, lang));
  if (running === undefined) return;
  running.controller.abort();
  await running.done.catch(() => undefined);
}

/**
 * Starts (or restarts) a download from the area's manifest in `lang`: every file's row, those
 * already verified on the phone kept, then the run.
 */
export async function startDownload(areaId: string, lang: string, wifiOnly: boolean) {
  const db = await databaseReady;
  const { data } = await offlineManifest(areaId, { lang });
  const { files, map } = filesOf(data);
  await addFiles(db, files);
  const existing = await packOfArea(db, areaId, lang);
  const all = await filesOfPack(db, areaId, lang);
  await savePack(db, {
    areaId,
    lang,
    state: 'downloading',
    datasetVersion: data.datasetVersion,
    mapPackVersion: data.mapPack?.version ?? 0,
    bytes: all.reduce((sum, file) => sum + file.bytes, 0),
    wifiOnly,
    installedAt: existing?.installedAt ?? null,
    updatedAt: existing?.updatedAt ?? null,
    error: null,
    update: null,
    map,
  });
  await refreshPacks();
  return runPack(areaId, lang);
}

export async function pausePack(areaId: string, lang: string): Promise<void> {
  await setPackState(await databaseReady, areaId, lang, 'paused');
  await halt(areaId, lang);
  await refreshPacks();
  notifyPack(areaId, lang, 'paused');
}

export async function resumePack(areaId: string, lang: string): Promise<void> {
  await setPackState(await databaseReady, areaId, lang, 'downloading');
  await refreshPacks();
  void runPack(areaId, lang);
}

/** *Use mobile data* (frames D1b, D3c): this download may use it from now on. */
export async function allowMobileData(areaId: string, lang: string): Promise<void> {
  const db = await databaseReady;
  await db.run('UPDATE packs SET wifi_only = 0 WHERE area_id = ? AND lang = ?', [areaId, lang]);
  await resumePack(areaId, lang);
}

/**
 * Removes a pack: its own files and rows, and the files every language of the area shares (the
 * map, the photos) only when no other pack of the area remains (K10, K17). Synced Places stay.
 * Returns the bytes freed.
 */
export async function removePack(areaId: string, lang: string): Promise<number> {
  await halt(areaId, lang);
  const db = await databaseReady;
  const others = (await allPacks(db)).filter(
    (pack) => pack.areaId === areaId && pack.lang !== lang,
  );
  const files = filesToRemove(await filesOfPack(db, areaId, lang), others.length);
  let freed = 0;
  for (const file of files) {
    for (const name of [file.name, `${file.name}.part`]) {
      const onDisk = packFile(areaId, name);
      if (onDisk.exists) {
        freed += onDisk.size;
        onDisk.delete();
      }
    }
  }
  await deleteFileRows(db, files);
  await deletePackRow(db, areaId, lang);
  if (others.length === 0) {
    const folder = areaFolder(areaId);
    if (folder.exists) folder.delete();
  }
  usePackStore.setState((state) => {
    const progress = { ...state.progress };
    delete progress[packKey(areaId, lang)];
    return { progress };
  });
  await refreshPacks();
  await refreshPackIndex();
  notifyPack(areaId, lang, null);
  return freed;
}

/** *Cancel* (frame D8): nothing is kept. */
export async function cancelDownload(areaId: string, lang: string): Promise<void> {
  await removePack(areaId, lang);
  showToast(tourist().t('pack.toast.cancelled'));
}

/**
 * Downloads go on by themselves where they can: at launch (a killed download, K9), when the network
 * changes or the gateway answers again (K6), and when the app comes back (a full phone, K7).
 * Paused, failed and ready packs wait for the tourist.
 */
export async function resumeDownloads(): Promise<void> {
  await refreshPacks();
  for (const pack of usePackStore.getState().packs) {
    if (RESUMABLE_STATES.includes(pack.state)) void runPack(pack.areaId, pack.lang);
  }
}

/** The answer for a pack's update: its diff, or the full manifest when the diff is gone (`409`). */
async function changesFor(pack: Pack): Promise<null | {
  files: ReturnType<typeof filesOf>;
  datasetVersion: number;
  mapPackVersion: number;
  changedPlaceIds: string[];
  audio: { placeId: string }[];
  empty: boolean;
}> {
  try {
    // Always the server's answer: the phone's HTTP cache may hold an older one for a minute.
    const answer = await offlineDiff(
      pack.areaId,
      {
        lang: pack.lang,
        fromDatasetVersion: String(pack.datasetVersion),
        fromMapPackVersion: pack.mapPackVersion,
      },
      { headers: { 'Cache-Control': 'no-cache' } },
    );
    // A 304 (unchanged since the copy the phone holds) has no body: nothing new.
    if (answer === undefined) return null;
    const { data } = answer;
    return {
      files: filesOf(data),
      datasetVersion: data.datasetVersion,
      mapPackVersion: data.mapPack?.version ?? pack.mapPackVersion,
      changedPlaceIds: data.changedPlaceIds,
      audio: data.audio,
      empty: isEmptyDiff(data),
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'DIFF_UNAVAILABLE') throw error;
    // The diff is gone: the full manifest, keeping every file whose hash is unchanged.
    const { data } = await offlineManifest(pack.areaId, { lang: pack.lang });
    return {
      files: filesOf(data),
      datasetVersion: data.datasetVersion,
      mapPackVersion: data.mapPack?.version ?? 0,
      changedPlaceIds: [],
      audio: data.audio,
      empty: false,
    };
  }
}

/**
 * Asks each ready pack whether it has an update (K14): when the app opens online and when the
 * connection returns; nothing polls with the app closed. A non-empty answer makes it `update`, with
 * frame M3's numbers; with *Update automatically on Wi-Fi* on and on Wi-Fi, it is applied (K15).
 */
export async function checkUpdates(): Promise<void> {
  const db = await databaseReady;
  for (const pack of await allPacks(db)) {
    if (pack.state !== 'ready' && pack.state !== 'update') continue;
    let changes;
    try {
      changes = await changesFor(pack);
    } catch {
      continue; // offline, or the server unwell: asked again next time
    }
    if (changes === null || changes.empty) continue;
    const held = await filesOfPack(db, pack.areaId, pack.lang);
    const update = updateSummary(held, changes, changes.files.files, pack.updatedAt ?? 0);
    await savePack(db, { ...pack, state: 'update', update });
  }
  await refreshPacks();
  if (usePackSettings.getState().autoUpdate && (await networkKind()) === 'wifi') {
    for (const pack of usePackStore.getState().packs) {
      if (pack.state === 'update') void applyUpdate(pack.areaId, pack.lang, true);
    }
  }
}

/**
 * *Update* (frame M3): only the files the phone lacks, then re-activation, which drops what no
 * record names any more (K14). Automatic, it says what changed after (frame M3b).
 */
export async function applyUpdate(areaId: string, lang: string, automatic = false) {
  const db = await databaseReady;
  const pack = await packOfArea(db, areaId, lang);
  if (pack === null) return;
  const changes = await changesFor(pack);
  if (changes === null) return;
  await addFiles(db, changes.files.files);
  const summary = pack.update;
  // The map is the area's, shared by every language: each pack of the area follows a new one.
  for (const other of await allPacks(db)) {
    if (other.areaId !== areaId) continue;
    const mine = other.lang === lang;
    await savePack(db, {
      ...other,
      state: mine ? 'downloading' : other.state,
      datasetVersion: mine ? changes.datasetVersion : other.datasetVersion,
      mapPackVersion: changes.mapPackVersion,
      map: changes.files.map ?? other.map,
      update: mine ? null : other.update,
    });
  }
  await refreshPacks();
  const state = await runPack(areaId, lang);
  if (state === 'ready' && automatic && summary !== null) {
    showToast(
      tourist().t('pack.toast.updated', {
        area: areaName(areaId),
        changed: summary.changed,
        added: summary.added,
      }),
    );
  }
}

/** *Forget this install*: every download stopped, both tables and the folder gone. */
export async function forgetPacks(): Promise<void> {
  for (const { controller } of runs.values()) controller.abort();
  const db = await databaseReady;
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM pack_files');
    await tx.run('DELETE FROM packs');
  });
  const root = packsRoot();
  if (root.exists) root.delete();
  resetPackSettings();
  usePackStore.setState({ packs: [], progress: {}, usedBytes: 0 });
  await refreshPackIndex();
}

/**
 * Diagnostics' *Damage a file* (K23): one of a ready pack's audio files cut short, so the next
 * launch finds the pack damaged (frame M4).
 */
export async function damageAFile(): Promise<boolean> {
  const db = await databaseReady;
  for (const pack of await allPacks(db)) {
    if (pack.state !== 'ready') continue;
    const audio = (await filesOfPack(db, pack.areaId, pack.lang)).find(
      (file) => file.kind === 'audio' && file.verified,
    );
    if (audio === undefined) continue;
    packFile(pack.areaId, audio.name).write(new Uint8Array([0]));
    return true;
  }
  return false;
}
