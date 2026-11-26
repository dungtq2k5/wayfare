import { ApiError } from '@wayfare/api-client';
import { AnalyticsEventType } from '@wayfare/contracts';
import type { OfflineManifest } from '@wayfare/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { Database } from '../db/database';
import type { Pack, PackState } from './db';
import type { Progress } from './engine';

vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);
vi.mock('../data/boot', async () => {
  const { openTestDatabase } = await import('../db/test-database');
  const { migrate } = await import('../db/migrate');
  const db = openTestDatabase();
  await migrate(db);
  return { databaseReady: Promise.resolve(db) };
});
const api = vi.hoisted(() => ({
  offlineManifest: vi.fn<(areaId: string, params: { lang: string }) => Promise<unknown>>(),
  offlineDiff: vi.fn<(areaId: string, params: object, init: object) => Promise<unknown>>(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const said = vi.hoisted(() => ({
  track: vi.fn<(event: { type: string; props?: object }) => void>(),
  toast: vi.fn<(text: string) => void>(),
  notify: vi.fn<(areaId: string, lang: string, state: string | null, progress?: object) => void>(),
  index: vi.fn(() => Promise.resolve()),
}));
vi.mock('../analytics/analytics', () => ({ track: said.track }));
vi.mock('../ui/toast', () => ({ showToast: said.toast }));
vi.mock('./notify', () => ({ notifyPack: said.notify }));
vi.mock('./use-pack-files', () => ({ refreshPackIndex: said.index }));
vi.mock('./area-name', () => ({ areaName: () => 'District 1' }));
vi.mock('../i18n', () => ({
  tourist: () => ({
    t: (key: string, args?: object) => (args ? `${key} ${JSON.stringify(args)}` : key),
  }),
}));
const settings = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock('./settings', () => ({
  usePackSettings: create(() => ({ autoUpdate: false, offered: [] as string[] })),
  resetPackSettings: settings.reset,
}));
type On = { changed: () => void; progress: (areaId: string, lang: string, p: Progress) => void };
const engine = vi.hoisted(() => ({
  on: null as On | null,
  network: vi.fn(() => Promise.resolve('wifi')),
  run: vi.fn<
    (deps: unknown, areaId: string, lang: string, signal: AbortSignal) => Promise<string>
  >(),
}));
vi.mock('./engine-deps', () => ({
  engineDeps: (_db: unknown, on: On) => {
    engine.on = on;
    return { fake: true };
  },
  networkKind: engine.network,
}));
vi.mock('./engine', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runDownload: engine.run,
}));

const controller = await import('./controller');
const { usePackStore, packKey } = controller;
const { usePackSettings } = await import('./settings');
const { disk } = await import('../testing/packs-fakes');
const { addFiles, allPacks, filesOfPack, packOfArea, savePack, setVerified } = await import('./db');
const { filesOf } = await import('./plan');
const db: Database = await (await import('../data/boot')).databaseReady;

const AREA = '01a0b373-d3eb-73c0-bd64-001fdcfca699';
const PLACE = '01a0b373-d3eb-73c0-bd64-001fdcfca69a';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const asset = (path: string, n: number, bytes = 10) => ({
  path,
  url: `http://media.test/${path}`,
  sha256: sha(n),
  bytes,
});
const manifest = (lang = 'en', version = 2, places = 5): OfflineManifest => ({
  areaId: AREA,
  lang: lang as OfflineManifest['lang'],
  datasetVersion: 50,
  mapPack: {
    version,
    pmtiles: asset(`maps/d1/${version}/map.pmtiles`, 1, 100),
    style: asset(`maps/d1/${version}/style.json`, 2),
    styleDark: null,
    assets: [],
  },
  places: asset(`offline/d1/${lang}/places.ndjson.gz`, places),
  photos: [asset('places/p1/card.jpg', 6)],
  audio: [{ ...asset(`narration/${lang}/p1.mp3`, 7), placeId: PLACE }],
  totalBytes: 140,
});
const pack = (fields: Partial<Pack> = {}): Pack => ({
  areaId: AREA,
  lang: 'en',
  state: 'ready',
  datasetVersion: 50,
  mapPackVersion: 2,
  bytes: 140,
  wifiOnly: true,
  installedAt: 1_000,
  updatedAt: 2_000,
  error: null,
  update: null,
  map: filesOf(manifest()).map,
  ...fields,
});
/** A pack and its file rows, all verified unless said otherwise. */
async function seed(fields: Partial<Pack> = {}, verified = true) {
  const { files } = filesOf(manifest(fields.lang ?? 'en'));
  await savePack(db, pack(fields));
  await addFiles(db, files);
  if (verified) for (const file of files) await setVerified(db, file, true);
  return files;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  engine.run.mockResolvedValue('ready');
  engine.network.mockResolvedValue('wifi');
  await db.run('DELETE FROM pack_files');
  await db.run('DELETE FROM packs');
  disk.reset();
  usePackStore.setState({ packs: [], progress: {}, usedBytes: 0 });
  usePackSettings.setState({ autoUpdate: false });
});
// A run ends after its test: the controller's runs are the module's, so each settles first.
afterEach(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe('the packs as every screen reads them', () => {
  it('shows each download’s bytes and stage from its rows, and the bytes the phone holds', async () => {
    const files = await seed({ state: 'paused' }, false);
    await setVerified(db, files[0]!, true);
    await controller.refreshPacks();
    const { packs, progress, usedBytes } = usePackStore.getState();
    expect(packs.map((p) => p.state)).toEqual(['paused']);
    expect(progress[packKey(AREA, 'en')]).toEqual({ done: 100, total: 140, stage: 'map' });
    expect(usedBytes).toBe(100);
  });

  it('says a pack with every file verified is checking, and nothing held is zero bytes', async () => {
    await seed({ state: 'checking' });
    await controller.refreshPacks();
    expect(usePackStore.getState().progress[packKey(AREA, 'en')]?.stage).toBe('checking');
    await db.run('DELETE FROM pack_files');
    await controller.refreshPacks();
    expect(usePackStore.getState().usedBytes).toBe(0);
  });

  it('lets only the latest of two overlapping reads write', async () => {
    await seed();
    await Promise.all([controller.refreshPacks(), controller.refreshPacks()]);
    expect(usePackStore.getState().packs).toHaveLength(1);
  });
});

describe('a download’s run', () => {
  it('joins a run already under way: Download twice is one download', async () => {
    await seed({ state: 'downloading' }, false);
    const first = controller.runPack(AREA, 'en');
    expect(controller.runPack(AREA, 'en')).toBe(first);
    expect(await first).toBe('ready');
    expect(engine.run).toHaveBeenCalledTimes(1);
  });

  it('says a finished download once: the toast, the count, the index and the notification', async () => {
    await seed();
    await controller.runPack(AREA, 'en');
    expect(said.index).toHaveBeenCalled();
    expect(said.toast).toHaveBeenCalledWith('pack.toast.ready {"area":"District 1"}');
    expect(said.track).toHaveBeenCalledWith({
      type: AnalyticsEventType.PACK_INSTALLED,
      props: { areaId: AREA },
    });
    expect(said.notify).toHaveBeenLastCalledWith(AREA, 'en', 'ready', {
      done: 140,
      total: 140,
      stage: 'checking',
    });
  });

  it('says a stopped download without a toast, and a pack gone as zero bytes', async () => {
    engine.run.mockResolvedValue('failed');
    await controller.runPack(AREA, 'en');
    expect(said.toast).not.toHaveBeenCalled();
    expect(said.notify).toHaveBeenLastCalledWith(AREA, 'en', 'failed', {
      done: 0,
      total: 0,
      stage: 'checking',
    });
  });

  it('shows the engine’s progress on the bar and in the notification, and reads again on a change', async () => {
    await seed({ state: 'downloading' }, false);
    await controller.runPack(AREA, 'en');
    engine.on!.progress(AREA, 'en', { done: 30, total: 140, stage: 'photo' });
    expect(usePackStore.getState().progress[packKey(AREA, 'en')]).toEqual({
      done: 30,
      total: 140,
      stage: 'photo',
    });
    expect(said.notify).toHaveBeenLastCalledWith(AREA, 'en', 'progress', {
      done: 30,
      total: 140,
      stage: 'photo',
    });
    usePackStore.setState({ packs: [] });
    engine.on!.changed();
    await flush();
    expect(usePackStore.getState().packs).toHaveLength(1);
  });

  it('starts a download from the manifest, keeping files already verified and when it was installed', async () => {
    await seed({ installedAt: 7, updatedAt: 8 });
    api.offlineManifest.mockResolvedValue({ data: manifest() });
    await controller.startDownload(AREA, 'en', false);
    const saved = await packOfArea(db, AREA, 'en');
    expect(saved).toMatchObject({
      state: 'downloading',
      bytes: 140,
      mapPackVersion: 2,
      wifiOnly: false,
      installedAt: 7,
      updatedAt: 8,
    });
    expect((await filesOfPack(db, AREA, 'en')).every((file) => file.verified)).toBe(true);
    expect(engine.run).toHaveBeenCalled();
  });

  it('starts a first download, with no map when the area has none', async () => {
    api.offlineManifest.mockResolvedValue({ data: { ...manifest(), mapPack: null } });
    await controller.startDownload(AREA, 'en', true);
    expect(await packOfArea(db, AREA, 'en')).toMatchObject({
      mapPackVersion: 0,
      installedAt: null,
      map: null,
    });
  });
});

/** A run that lasts until it is aborted, as a real download would. */
function runUntilAborted() {
  engine.run.mockImplementation(
    (_deps, _area, _lang, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) resolve('paused');
        signal.addEventListener('abort', () => resolve('paused'));
      }),
  );
}

describe('pausing, resuming and mobile data', () => {
  it('pauses where it is: the run stops and the notification goes', async () => {
    await seed({ state: 'downloading' }, false);
    runUntilAborted();
    const run = controller.runPack(AREA, 'en');
    await controller.pausePack(AREA, 'en');
    expect(await run).toBe('paused');
    expect((await packOfArea(db, AREA, 'en'))?.state).toBe('paused');
    expect(said.notify).toHaveBeenLastCalledWith(AREA, 'en', 'paused');
  });

  it('resumes a paused download, and allows mobile data from then on', async () => {
    await seed({ state: 'paused' }, false);
    await controller.resumePack(AREA, 'en');
    expect((await packOfArea(db, AREA, 'en'))?.state).toBe('downloading');
    expect(engine.run).toHaveBeenCalledTimes(1);
    await flush();
    await controller.allowMobileData(AREA, 'en');
    expect((await packOfArea(db, AREA, 'en'))?.wifiOnly).toBe(false);
  });

  it('goes on by itself only where the download can: paused, failed and ready packs wait', async () => {
    await seed({ state: 'waiting-wifi' }, false);
    await seed({ state: 'paused', lang: 'vi' }, false);
    await controller.resumeDownloads();
    await flush();
    expect(engine.run.mock.calls.map((call) => call[2])).toEqual(['en']);
  });
});

describe('removing a pack (K10, K17)', () => {
  const onDisk = (name: string, bytes: number) =>
    disk.files.set(`file:///doc/packs/${AREA}/${name}`, new Uint8Array(bytes));

  it('frees its files and the area’s shared ones when it is the area’s last pack', async () => {
    const files = await seed();
    for (const file of files) onDisk(file.name, file.bytes);
    onDisk(`${files.at(-1)!.name}.part`, 3);
    disk.folders.add(`file:///doc/packs/${AREA}`);
    usePackStore.setState({
      progress: { [packKey(AREA, 'en')]: { done: 1, total: 2, stage: 'map' } },
    });
    expect(await controller.removePack(AREA, 'en')).toBe(143);
    expect(disk.files.size).toBe(0);
    expect(disk.folders.has(`file:///doc/packs/${AREA}`)).toBe(false);
    expect(await allPacks(db)).toEqual([]);
    expect(usePackStore.getState().progress).toEqual({});
    expect(said.notify).toHaveBeenLastCalledWith(AREA, 'en', null);
  });

  it('keeps the map and photos another language’s pack of the area still uses', async () => {
    const files = await seed();
    await seed({ lang: 'vi' });
    for (const file of files) onDisk(file.name, file.bytes);
    const freed = await controller.removePack(AREA, 'en');
    expect(freed).toBe(20);
    expect([...disk.files.keys()].some((path) => path.includes('map.pmtiles'))).toBe(true);
    expect((await allPacks(db)).map((p) => p.lang)).toEqual(['vi']);
  });

  it('cancels a download with nothing kept, and says so', async () => {
    await seed({ state: 'downloading' }, false);
    runUntilAborted();
    void controller.runPack(AREA, 'en');
    await controller.cancelDownload(AREA, 'en');
    expect(await allPacks(db)).toEqual([]);
    expect(said.toast).toHaveBeenCalledWith('pack.toast.cancelled');
  });
});

describe('a pack’s updates (K14, K15)', () => {
  const diff = (fields: object = {}) => ({
    data: {
      ...manifest('en', 2, 9),
      datasetVersion: 60,
      changedPlaceIds: [PLACE],
      removedPlaceIds: [],
      mapPack: null,
      audio: [{ ...asset('narration/en/p2.mp3', 8), placeId: 'p2' }],
      ...fields,
    },
  });

  it('marks a ready pack with a change as having an update, with frame M3’s numbers', async () => {
    await seed();
    api.offlineDiff.mockResolvedValue(diff());
    await controller.checkUpdates();
    expect(api.offlineDiff).toHaveBeenCalledWith(
      AREA,
      { lang: 'en', fromDatasetVersion: '50', fromMapPackVersion: 2 },
      { headers: { 'Cache-Control': 'no-cache' } },
    );
    expect(await packOfArea(db, AREA, 'en')).toMatchObject({
      state: 'update',
      update: { changed: 1, added: 1, since: 2_000 },
    });
  });

  it('leaves a pack alone when nothing changed, the answer is unchanged, or the server is unwell', async () => {
    await seed();
    await seed({ lang: 'vi', state: 'paused' });
    api.offlineDiff.mockResolvedValueOnce(diff({ changedPlaceIds: [] }));
    await controller.checkUpdates();
    api.offlineDiff.mockResolvedValueOnce(undefined);
    await controller.checkUpdates();
    api.offlineDiff.mockRejectedValueOnce(new Error('offline'));
    await controller.checkUpdates();
    expect((await allPacks(db)).map((p) => p.state)).toEqual(['ready', 'paused']);
    expect(api.offlineDiff).toHaveBeenCalledTimes(3);
  });

  it('reads the full manifest when the diff is gone', async () => {
    await seed({ updatedAt: null });
    api.offlineDiff.mockRejectedValue(new ApiError(409, 'DIFF_UNAVAILABLE', 'gone'));
    api.offlineManifest.mockResolvedValue({ data: manifest('en', 3, 9) });
    await controller.checkUpdates();
    expect(await packOfArea(db, AREA, 'en')).toMatchObject({
      state: 'update',
      update: { since: 0 },
    });
  });

  it('applies updates by itself on Wi-Fi when automatic updates are on, and says what changed', async () => {
    await seed();
    usePackSettings.setState({ autoUpdate: true });
    api.offlineDiff.mockResolvedValue(diff());
    await controller.checkUpdates();
    await flush();
    await flush();
    expect(engine.run).toHaveBeenCalled();
    expect(said.toast).toHaveBeenCalledWith(
      'pack.toast.updated {"area":"District 1","changed":1,"added":1}',
    );
  });

  it('waits for Wi-Fi to apply an update by itself', async () => {
    await seed();
    usePackSettings.setState({ autoUpdate: true });
    engine.network.mockResolvedValue('cellular');
    api.offlineDiff.mockResolvedValue(diff());
    await controller.checkUpdates();
    expect(engine.run).not.toHaveBeenCalled();
  });

  it('updates only the files the phone lacks; every pack of the area follows a new map', async () => {
    await seed({ state: 'update' });
    await seed({ lang: 'vi' });
    api.offlineDiff.mockResolvedValue(diff({ mapPack: manifest('en', 3).mapPack }));
    await controller.applyUpdate(AREA, 'en');
    const [en, vi] = await allPacks(db);
    expect(en).toMatchObject({ state: 'downloading', datasetVersion: 60, mapPackVersion: 3 });
    expect(vi).toMatchObject({ state: 'ready', datasetVersion: 50, mapPackVersion: 3 });
    expect(said.toast).not.toHaveBeenCalledWith(expect.stringContaining('pack.toast.updated'));
  });

  it('applies nothing for a pack not on the phone, or a diff with nothing new', async () => {
    await controller.applyUpdate(AREA, 'en');
    await seed();
    api.offlineDiff.mockResolvedValue(undefined);
    await controller.applyUpdate(AREA, 'en');
    expect(engine.run).not.toHaveBeenCalled();
  });

  it('keeps the area’s map when the diff brings none', async () => {
    await seed({ state: 'update' });
    api.offlineDiff.mockResolvedValue(diff());
    await controller.applyUpdate(AREA, 'en', true);
    expect((await packOfArea(db, AREA, 'en'))?.map).toEqual(pack().map);
  });
});

describe('forgetting the install, and Diagnostics', () => {
  it('stops every download and leaves no table row, folder or setting', async () => {
    await seed({ state: 'downloading' }, false);
    runUntilAborted();
    const run = controller.runPack(AREA, 'en');
    disk.folders.add('file:///doc/packs');
    await controller.forgetPacks();
    expect(await run).toBe('paused');
    expect(await allPacks(db)).toEqual([]);
    expect(await db.all('SELECT * FROM pack_files')).toEqual([]);
    expect(disk.folders.has('file:///doc/packs')).toBe(false);
    expect(settings.reset).toHaveBeenCalled();
    expect(usePackStore.getState()).toEqual({ packs: [], progress: {}, usedBytes: 0 });
    await controller.forgetPacks();
  });

  it('damages one verified story of a ready pack, and none when no ready pack has one', async () => {
    expect(await controller.damageAFile()).toBe(false);
    await seed({ state: 'paused' });
    await seed({ lang: 'vi' }, false);
    expect(await controller.damageAFile()).toBe(false);
    await seed({ lang: 'ja' });
    expect(await controller.damageAFile()).toBe(true);
    const written = [...disk.files.entries()].find(([path]) => path.includes('/ja/audio/'));
    expect(written?.[1]).toEqual(new Uint8Array([0]));
  });
});

// Typed for the state checks above.
export type { PackState };
