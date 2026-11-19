import { describe, expect, it, vi } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { checkPacks, damageOf } from './damage';
import { addFiles, filesOfPack, packOfArea, savePack, setPackState, setVerified } from './db';
import type { Pack } from './db';
import { FetchError, runDownload, SLOW_CHECKING_MS, SLOW_FILE_MS } from './engine';
import type { EngineDeps } from './engine';
import { formatSize, shortDate } from './format';
import { localStyle } from './local-style';
import type { PackFile } from './plan';
import { pruneFiles } from './updates';

const AREA = 'a1';
const file = (name: string, kind: PackFile['kind'] = 'photo', bytes = 10): PackFile => ({
  areaId: AREA,
  lang: kind === 'photo' || kind === 'map' ? '' : 'en',
  kind,
  name,
  url: `http://media.test/${name}`,
  sha256: `sha-${name}`,
  bytes,
  placeId: null,
  verified: false,
});
const pack: Pack = {
  areaId: AREA,
  lang: 'en',
  state: 'downloading',
  datasetVersion: 1,
  mapPackVersion: 1,
  bytes: 20,
  wifiOnly: false,
  installedAt: null,
  updatedAt: null,
  error: null,
  update: null,
  map: null,
};

/** A pack of two photos, and an engine whose every file answers right unless the test says. */
async function setup(overrides: Partial<EngineDeps> = {}) {
  const db = openTestDatabase();
  await migrate(db);
  await savePack(db, pack);
  await addFiles(db, [file('p1.jpg'), file('p2.jpg')]);
  const deps: EngineDeps = {
    db,
    fetchFile: vi.fn(() => Promise.resolve()),
    hashOf: (_area, temp) => Promise.resolve(`sha-${temp.replace('.part', '')}`),
    move: vi.fn(() => Promise.resolve()),
    remove: vi.fn(),
    network: () => Promise.resolve('wifi'),
    freeBytes: () => 1e9,
    clearCaches: vi.fn(() => Promise.resolve()),
    activate: vi.fn(() => Promise.resolve()),
    wait: vi.fn(() => Promise.resolve()),
    now: () => 0,
    holds: () => ({ slow: false, failNext: false }),
    clearFailNext: vi.fn(),
    changed: vi.fn(),
    progress: vi.fn(),
    ...overrides,
  };
  return { db, deps };
}
const run = (deps: EngineDeps, signal = new AbortController().signal) =>
  runDownload(deps, AREA, 'en', signal);
const failing = (error: Error) => vi.fn(() => Promise.reject(error));

describe('a download’s edges', () => {
  it('fails a pack that isn’t on the phone', async () => {
    const { deps } = await setup();
    expect(await runDownload(deps, 'elsewhere', 'en', new AbortController().signal)).toBe('failed');
  });

  it('waits for a connection on any unknown failure, and for space when the disk is full', async () => {
    const unknown = await setup({ fetchFile: failing(new Error('?')) });
    expect(await run(unknown.deps)).toBe('waiting-connection');
    const full = await setup({ fetchFile: failing(new FetchError('space')) });
    expect(await run(full.deps)).toBe('no-space');
  });

  it('fails a pack whose file the server no longer has, saying why', async () => {
    const { db, deps } = await setup({ fetchFile: failing(new FetchError('missing')) });
    expect(await run(deps)).toBe('failed');
    expect((await packOfArea(db, AREA, 'en'))?.error).toBe('missing');
  });

  it('ends a transfer cut short by a pause in the state the pause wrote', async () => {
    const controller = new AbortController();
    const { db, deps } = await setup({
      fetchFile: vi.fn(async () => {
        await setPackState(db, AREA, 'en', 'paused');
        controller.abort();
        throw new FetchError('aborted');
      }),
    });
    expect(await run(deps, controller.signal)).toBe('paused');
  });

  it('reads a pause written by a pack since removed as paused', async () => {
    const controller = new AbortController();
    const { db, deps } = await setup({
      fetchFile: vi.fn(async () => {
        await db.run('DELETE FROM packs');
        controller.abort();
        throw new FetchError('aborted');
      }),
    });
    expect(await run(deps, controller.signal)).toBe('paused');
  });

  it('holds the first files and checking under Slow downloads', async () => {
    const { deps } = await setup({ holds: () => ({ slow: true, failNext: false }) });
    expect(await run(deps)).toBe('ready');
    expect(vi.mocked(deps.wait).mock.calls.map(([ms]) => ms)).toEqual([
      SLOW_FILE_MS,
      SLOW_FILE_MS,
      SLOW_CHECKING_MS,
    ]);
  });

  it('writes progress at most once a second, but always at a new file', async () => {
    const { deps } = await setup({
      fetchFile: vi.fn((_file: PackFile, _temp: string, onBytes: (n: number) => void) => {
        onBytes(5);
        onBytes(6);
        return Promise.resolve();
      }),
    });
    await run(deps);
    const stages = vi.mocked(deps.progress).mock.calls.map(([, , p]) => `${p.stage}:${p.done}`);
    expect(stages).toEqual(['photo:0', 'photo:10', 'checking:20']);
  });

  it('stops before checking when paused after the last file, keeping the pause', async () => {
    const controller = new AbortController();
    const { db, deps } = await setup();
    deps.move = vi.fn(async () => {
      if ((await filesOfPack(db, AREA, 'en')).filter((f) => f.verified).length === 1) {
        await setPackState(db, AREA, 'en', 'paused');
        controller.abort();
      }
    });
    expect(await run(deps, controller.signal)).toBe('paused');
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it('ends as the pack stands when it goes during checking, or a pause comes while activating', async () => {
    const gone = await setup({
      holds: () => ({ slow: true, failNext: false }),
    });
    gone.deps.wait = vi.fn(async (ms: number) => {
      if (ms === SLOW_CHECKING_MS) await gone.db.run('DELETE FROM packs');
    });
    expect(await run(gone.deps)).toBe('paused');

    const controller = new AbortController();
    const paused = await setup();
    paused.deps.activate = vi.fn(async () => {
      await setPackState(paused.db, AREA, 'en', 'paused');
      controller.abort();
    });
    expect(await run(paused.deps, controller.signal)).toBe('paused');
    expect((await packOfArea(paused.db, AREA, 'en'))?.state).toBe('paused');
  });
});

describe('damage at launch (K16)', () => {
  it('marks a pack with an unverified file damaged once, and checks only the packs in use', async () => {
    const { db } = await setup();
    await setPackState(db, AREA, 'en', 'ready');
    const [first] = await filesOfPack(db, AREA, 'en');
    await setVerified(db, first!, true);
    expect(await checkPacks(db, (f) => f.bytes)).toBe(1);
    expect(await checkPacks(db, (f) => f.bytes)).toBe(0);
    await setPackState(db, AREA, 'en', 'paused');
    expect(await checkPacks(db, () => null)).toBe(0);
  });

  it('counts nothing to repair in a whole pack', () => {
    expect(damageOf([{ ...file('a.mp3', 'audio'), verified: true }])).toEqual({
      stories: 0,
      bytes: 0,
    });
  });
});

describe('an update’s pruning (K14)', () => {
  it('drops every photo and story when no record names one any more', async () => {
    const { db } = await setup();
    await addFiles(db, [file('en/audio/a.mp3', 'audio')]);
    const records = [{ cardPhoto: null, localization: { audio: null } }] as never;
    const stale = await pruneFiles(db, pack, records, 'en/places.ndjson.gz');
    expect(stale.map((f) => f.name).sort((a, b) => a.localeCompare(b))).toEqual([
      'en/audio/a.mp3',
      'p1.jpg',
      'p2.jpg',
    ]);
    expect(await filesOfPack(db, AREA, 'en')).toEqual([]);
  });
});

describe('what the pack screens write', () => {
  it('writes a date day first, in the app’s language, and nothing for no date', () => {
    const at = Date.UTC(2026, 9, 14, 12);
    expect(shortDate(at, 'en')).toBe('14 Oct');
    expect(shortDate(at, 'vi')).toBe(
      new Date(at).toLocaleDateString('vi', { day: 'numeric', month: 'short' }),
    );
    expect(shortDate(null, 'en')).toBe('');
    expect(formatSize(-1)).toBe('0 MB');
  });

  it('points a style at the pack’s folder, with or without its trailing slash', () => {
    const style = '{"url":"https://m/p/map.pmtiles"}';
    expect(localStyle(style, 'https://m/p/', 'file:///f/')).toEqual({
      url: 'file:///f/map.pmtiles',
    });
    expect(localStyle(style, 'https://m/p/', 'file:///f')).toEqual({
      url: 'file:///f/map.pmtiles',
    });
  });
});
