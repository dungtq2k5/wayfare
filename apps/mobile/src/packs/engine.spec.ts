import type { OfflineManifest } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { addFiles, filesOfPack, packOfArea, savePack } from './db';
import type { Pack } from './db';
import { FetchError, runDownload } from './engine';
import type { EngineDeps, NetworkKind } from './engine';
import { filesOf, safeRelative } from './plan';
import type { PackFile } from './plan';

const AREA = '01a0b373-d3eb-73c0-bd64-001fdcfca699';
const PLACE = '01a0b373-d3eb-73c0-bd64-001fdcfca69a';
const BASE = 'http://media.test/wayfare';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const asset = (path: string, n: number, bytes = 10) => ({
  path,
  url: `${BASE}/${encodeURI(path)}`,
  sha256: sha(n),
  bytes,
});

const manifest: OfflineManifest = {
  areaId: AREA,
  lang: 'en',
  datasetVersion: 50,
  mapPack: {
    version: 2,
    pmtiles: asset('maps/hcmc-d1/abc/map.pmtiles', 1, 100),
    style: asset('maps/hcmc-d1/abc/style.json', 2),
    styleDark: asset('maps/hcmc-d1/abc/style-dark.json', 3),
    assets: [asset('maps/hcmc-d1/abc/fonts/Noto Sans Regular/0-255.pbf', 4)],
  },
  places: asset('offline/hcmc-d1/en/v2-50-18.ndjson.gz', 5),
  photos: [asset('places/p1/card.jpg', 6)],
  audio: [{ ...asset('narration/en/p1.mp3', 7), placeId: PLACE }],
  totalBytes: 170,
};

/** Fake files and network: each URL answers its file's own hash unless the test says otherwise. */
function fakes(overrides: Partial<EngineDeps> = {}) {
  const db = openTestDatabase();
  const disk = new Map<string, string>(); // name → the hash its content has
  const fetched: string[] = [];
  const answers = new Map<string, (PackFile | FetchError)[]>();
  const deps: EngineDeps = {
    db,
    fetchFile: vi.fn((file: PackFile, temp: string) => {
      fetched.push(file.name);
      const queued = answers.get(file.name)?.shift();
      if (queued instanceof FetchError) return Promise.reject(queued);
      disk.set(temp, queued?.sha256 ?? file.sha256);
      return Promise.resolve();
    }),
    hashOf: (_area, name) => Promise.resolve(disk.get(name) ?? ''),
    move: (_area, from, to) => {
      disk.set(to, disk.get(from) ?? '');
      disk.delete(from);
      return Promise.resolve();
    },
    remove: (_area, name) => {
      disk.delete(name);
    },
    network: () => Promise.resolve('wifi'),
    freeBytes: () => 1e9,
    clearCaches: vi.fn(() => Promise.resolve()),
    activate: vi.fn(() => Promise.resolve()),
    wait: vi.fn(() => Promise.resolve()),
    now: () => 1_000,
    holds: () => ({ slow: false, failNext: false }),
    clearFailNext: vi.fn(),
    changed: vi.fn(),
    progress: vi.fn(),
    ...overrides,
  };
  return { db, deps, fetched, answers, disk };
}

async function seed(db: EngineDeps['db'], pack: Partial<Pack> = {}) {
  await migrate(db);
  const { files, map } = filesOf(manifest);
  await savePack(db, {
    areaId: AREA,
    lang: 'en',
    state: 'downloading',
    datasetVersion: 50,
    mapPackVersion: 2,
    bytes: 170,
    wifiOnly: true,
    installedAt: null,
    updatedAt: null,
    error: null,
    update: null,
    map,
    ...pack,
  });
  await addFiles(db, files);
  return files;
}

const run = (deps: EngineDeps, signal = new AbortController().signal) =>
  runDownload(deps, AREA, 'en', signal);

describe('the pack files', () => {
  it('keeps map paths under the pack prefix, and names photos and audio by their hash', () => {
    const { files, map } = filesOf(manifest);
    expect(files.map((file) => `${file.kind} ${file.lang || '-'} ${file.name}`)).toEqual([
      'map - map/2/map.pmtiles',
      'map - map/2/style.json',
      'map - map/2/style-dark.json',
      'map - map/2/fonts/Noto Sans Regular/0-255.pbf',
      `places en en/places-${sha(5)}.ndjson.gz`,
      `photo - photos/${sha(6)}.jpg`,
      `audio en en/audio/${sha(7)}.mp3`,
    ]);
    expect(files.find((file) => file.kind === 'audio')?.placeId).toBe(PLACE);
    expect(map).toMatchObject({
      version: 2,
      prefixUrl: `${BASE}/maps/hcmc-d1/abc/`,
      style: 'map/2/style.json',
      styleDark: 'map/2/style-dark.json',
    });
  });

  it('never lets a server path with `..` reach the disk', () => {
    expect(safeRelative('fonts/Noto Sans Regular/0-255.pbf')).toBe(true);
    expect(safeRelative('sprites/v4/light@2x.png')).toBe(true);
    expect(safeRelative('../../shared_prefs/x')).toBe(false);
    expect(safeRelative('a//b')).toBe(false);
    const evil = {
      ...manifest,
      mapPack: { ...manifest.mapPack!, assets: [asset('maps/hcmc-d1/abc/../../../x', 9)] },
    };
    expect(() => filesOf(evil)).toThrow(/Unsafe/);
    // Photos and audio never use the server's path at all.
    const odd = { ...manifest, photos: [asset('../../etc/passwd', 8)] };
    expect(filesOf(odd).files.find((file) => file.kind === 'photo')?.name).toBe(`photos/${sha(8)}`);
  });
});

describe('the download', () => {
  let f: ReturnType<typeof fakes>;
  beforeEach(() => {
    f = fakes();
  });

  it('fetches map, places, photos, audio in that order, and activates', async () => {
    await seed(f.db);
    expect(await run(f.deps)).toBe('ready');
    expect(f.fetched).toEqual([
      'map/2/map.pmtiles',
      'map/2/style.json',
      'map/2/style-dark.json',
      'map/2/fonts/Noto Sans Regular/0-255.pbf',
      `en/places-${sha(5)}.ndjson.gz`,
      `photos/${sha(6)}.jpg`,
      `en/audio/${sha(7)}.mp3`,
    ]);
    expect(f.deps.activate).toHaveBeenCalledTimes(1);
    expect(await packOfArea(f.db, AREA, 'en')).toMatchObject({
      state: 'ready',
      installedAt: 1_000,
    });
    expect((await filesOfPack(f.db, AREA, 'en')).every((file) => file.verified)).toBe(true);
  });

  it('renames a file only when its hash matches; one retry, then the pack fails', async () => {
    const files = await seed(f.db);
    const style = files[1]!;
    f.answers.set(style.name, [
      { ...style, sha256: 'wrong' },
      { ...style, sha256: 'wrong' },
    ]);
    expect(await run(f.deps)).toBe('failed');
    expect(f.fetched.filter((name) => name === style.name)).toHaveLength(2);
    expect(f.disk.has(style.name)).toBe(false);
    expect(f.disk.has(`${style.name}.part`)).toBe(false);
    const rows = await filesOfPack(f.db, AREA, 'en');
    expect(rows.find((row) => row.name === files[0]!.name)?.verified).toBe(true);
    expect(rows.find((row) => row.name === style.name)?.verified).toBe(false);
  });

  it('a mismatch fetched once more and right goes on', async () => {
    const files = await seed(f.db);
    f.answers.set(files[1]!.name, [{ ...files[1]!, sha256: 'wrong' }]);
    expect(await run(f.deps)).toBe('ready');
  });

  it('three 5xx in a row with a back-off fail the pack; the network waits instead', async () => {
    const files = await seed(f.db);
    f.answers.set(files[0]!.name, [
      new FetchError('server'),
      new FetchError('server'),
      new FetchError('server'),
    ]);
    expect(await run(f.deps)).toBe('failed');
    expect(f.deps.wait).toHaveBeenNthCalledWith(1, 2_000);
    expect(f.deps.wait).toHaveBeenNthCalledWith(2, 4_000);

    const g = fakes();
    const more = await seed(g.db);
    g.answers.set(more[3]!.name, [new FetchError('network')]);
    expect(await run(g.deps)).toBe('waiting-connection');
    // Back on the network: it goes on from the first unverified file (the relaunch's path too).
    g.fetched.length = 0;
    expect(await run(g.deps)).toBe('ready');
    expect(g.fetched[0]).toBe(more[3]!.name);
  });

  it('a file already verified on the phone is not fetched again', async () => {
    await seed(f.db);
    expect(await run(f.deps)).toBe('ready');
    // Another language of the area: the map and the photo are shared, so only its own files come.
    const ja = filesOf({ ...manifest, lang: 'ja', audio: [] });
    await savePack(f.db, {
      ...(await packOfArea(f.db, AREA, 'en'))!,
      lang: 'ja',
      state: 'downloading',
    });
    await addFiles(f.db, ja.files);
    f.fetched.length = 0;
    expect(await runDownload(f.deps, AREA, 'ja', new AbortController().signal)).toBe('ready');
    expect(f.fetched).toEqual([`ja/places-${sha(5)}.ndjson.gz`]);
  });

  it('waits for Wi-Fi on mobile data unless allowed; no network waits for a connection', async () => {
    await seed(f.db);
    expect(await run({ ...f.deps, network: () => Promise.resolve('cellular') })).toBe(
      'waiting-wifi',
    );
    expect(await run({ ...f.deps, network: () => Promise.resolve('none') })).toBe(
      'waiting-connection',
    );
    await seed(f.db, { wifiOnly: false });
    expect(await run({ ...f.deps, network: () => Promise.resolve('cellular') })).toBe('ready');
  });

  it('Wi-Fi dropping midway waits for Wi-Fi before the next file', async () => {
    await seed(f.db);
    let calls = 0;
    // Wi-Fi at the start and for the first file, then only mobile data.
    const network = () => Promise.resolve<NetworkKind>(calls++ < 2 ? 'wifi' : 'cellular');
    expect(await run({ ...f.deps, network })).toBe('waiting-wifi');
    expect(f.fetched).toEqual(['map/2/map.pmtiles']);
    expect(await run(f.deps)).toBe('ready');
  });

  it('clears the caches before refusing for space; full midway pauses for space', async () => {
    await seed(f.db);
    let free = 100; // under 170 × 1.1
    const deps = { ...f.deps, freeBytes: () => free };
    expect(await run(deps)).toBe('no-space');
    expect(f.deps.clearCaches).toHaveBeenCalledTimes(1);

    free = 1e9;
    let calls = 0;
    // Room at the start, then the phone fills up after the first file.
    const filling = { ...f.deps, freeBytes: () => (calls++ < 3 ? 1e9 : 10) };
    expect(await run(filling)).toBe('no-space');
    expect(await run(deps)).toBe('ready');
  });

  it('a pause ends the run where it is, keeping what is verified', async () => {
    await seed(f.db);
    const controller = new AbortController();
    const deps = {
      ...f.deps,
      fetchFile: (file: PackFile, temp: string) => {
        f.fetched.push(file.name);
        f.disk.set(temp, file.sha256);
        if (f.fetched.length === 2) controller.abort();
        return Promise.resolve();
      },
    };
    await runDownload(deps, AREA, 'en', controller.signal);
    const verified = (await filesOfPack(f.db, AREA, 'en')).filter((file) => file.verified);
    expect(verified.map((file) => file.name)).toEqual(['map/2/map.pmtiles', 'map/2/style.json']);
  });

  it('Fail the next file fails its check twice, then clears itself', async () => {
    await seed(f.db);
    expect(await run({ ...f.deps, holds: () => ({ slow: false, failNext: true }) })).toBe('failed');
    expect(f.deps.clearFailNext).toHaveBeenCalled();
  });
});

describe('damage', () => {
  it('a missing or wrong-sized file makes the pack damaged; repair fetches only those', async () => {
    const f = fakes();
    await seed(f.db);
    expect(await run(f.deps)).toBe('ready');
    const { checkPacks, damageOf } = await import('./damage');
    const audio = (await filesOfPack(f.db, AREA, 'en')).find((file) => file.kind === 'audio')!;
    expect(await checkPacks(f.db, (file) => (file.name === audio.name ? 3 : file.bytes))).toBe(1);
    expect((await packOfArea(f.db, AREA, 'en'))?.state).toBe('damaged');
    expect(damageOf(await filesOfPack(f.db, AREA, 'en'))).toEqual({ stories: 1, bytes: 10 });
    f.fetched.length = 0;
    expect(await run(f.deps)).toBe('ready');
    expect(f.fetched).toEqual([audio.name]);
  });
});

describe('updates', () => {
  it('sums only the files the phone lacks, counts changed Places and new stories', async () => {
    const { updateSummary } = await import('./updates');
    const held = filesOf(manifest).files.map((file) => ({ ...file, verified: true }));
    const other = '01a0b373-d3eb-73c0-bd64-001fdcfca69b';
    const diff = {
      ...manifest,
      mapPack: null,
      places: asset('offline/hcmc-d1/en/v2-60-18.ndjson.gz', 11),
      photos: [asset('places/p1/card.jpg', 6)], // unchanged: already here
      audio: [
        { ...asset('narration/en/p1-v2.mp3', 12), placeId: PLACE }, // a story replaced
        { ...asset('narration/en/p2.mp3', 13), placeId: other }, // a story new
      ],
    };
    const incoming = filesOf(diff).files;
    expect(
      updateSummary(held, { changedPlaceIds: [PLACE, other], audio: diff.audio }, incoming, 5),
    ).toEqual({
      bytes: 30,
      changed: 2,
      added: 1,
      since: 5,
    });
  });

  it('after re-activation, deletes the files no record of the new snapshot names', async () => {
    const { pruneFiles } = await import('./updates');
    const f = fakes();
    await seed(f.db);
    const pack = (await packOfArea(f.db, AREA, 'en'))!;
    // The new snapshot: the Place's photo the same, its story replaced; a new map version.
    const newer = filesOf({
      ...manifest,
      mapPack: { ...manifest.mapPack!, version: 3 },
      places: asset('offline/hcmc-d1/en/v2-60-18.ndjson.gz', 11),
      audio: [{ ...asset('narration/en/p1-v2.mp3', 12), placeId: PLACE }],
    }).files;
    await addFiles(f.db, newer);
    const records = [
      {
        cardPhoto: { sha256: sha(6) },
        localization: { audio: { sha256: sha(12) } },
      },
    ] as unknown as Parameters<typeof pruneFiles>[2];
    const removed = await pruneFiles(
      f.db,
      { ...pack, mapPackVersion: 3 },
      records,
      `en/places-${sha(11)}.ndjson.gz`,
    );
    expect(removed.map((file) => file.name).sort((a, b) => a.localeCompare(b))).toEqual(
      [
        'map/2/map.pmtiles',
        'map/2/style.json',
        'map/2/style-dark.json',
        'map/2/fonts/Noto Sans Regular/0-255.pbf',
        `en/places-${sha(5)}.ndjson.gz`,
        `en/audio/${sha(7)}.mp3`,
      ].sort((a, b) => a.localeCompare(b)),
    );
    const left = (await filesOfPack(f.db, AREA, 'en')).map((file) => file.name);
    expect(left).toContain(`photos/${sha(6)}.jpg`);
    expect(left).toContain(`en/audio/${sha(12)}.mp3`);
  });
});

describe('shared files', () => {
  it('removing one language keeps the map and photos while another pack of the area remains', async () => {
    const f = fakes();
    await seed(f.db);
    const ja = filesOf({ ...manifest, lang: 'ja' });
    await savePack(f.db, { ...(await packOfArea(f.db, AREA, 'en'))!, lang: 'ja' });
    await addFiles(f.db, ja.files);
    const { filesToRemove } = await import('./plan');
    const removable = filesToRemove(await filesOfPack(f.db, AREA, 'en'), 1);
    expect(removable.every((file) => file.lang === 'en')).toBe(true);
    expect(removable.map((file) => file.kind).sort((a, b) => a.localeCompare(b))).toEqual([
      'audio',
      'places',
    ]);
    // The last pack of the area takes the shared files with it.
    expect(filesToRemove(await filesOfPack(f.db, AREA, 'en'), 0)).toHaveLength(7);
  });
});
