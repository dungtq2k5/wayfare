import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { files, kv } from '../testing/player-fakes';
import type { PlaceAudio, PlayerPlace } from './player-place';

vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);
vi.mock('expo-file-system', () =>
  import('../testing/player-fakes').then((m) => m.fileSystemModule),
);
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (_algorithm: string, bytes: Uint8Array) =>
    Promise.resolve(createHash('sha256').update(bytes).digest().buffer),
}));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const place = (id: string) => ({ id }) as PlayerPlace;
const audio = (text: string): PlaceAudio => {
  files.downloads.set(`https://media.test/${text}.mp3`, new TextEncoder().encode(text));
  return { url: `https://media.test/${text}.mp3`, sha256: sha(text), durationMs: 1 };
};
const fileOf = (lang: string, id: string, text: string) =>
  `doc:/narration/${lang}/${id}-${sha(text).slice(0, 16)}.mp3`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The module keeps its index in memory: each test reads it fresh from storage. */
async function cache() {
  vi.resetModules();
  return import('./audio-cache');
}

describe('the narration audio cache (product §9)', () => {
  beforeEach(() => {
    kv.items.clear();
    kv.failing = false;
    files.existing.clear();
    files.downloads.clear();
    files.undeletable.clear();
  });

  it('downloads a narration into its language’s folder and finds it again', async () => {
    const { cachedFile, downloadToCache } = await cache();
    const story = audio('ben-thanh');
    expect(await cachedFile(place('p1'), story, 'en')).toBeNull();
    const uri = await downloadToCache(place('p1'), story, 'en');
    expect(uri).toBe(fileOf('en', 'p1', 'ben-thanh'));
    expect(await cachedFile(place('p1'), story, 'en')).toBe(uri);
    expect(await cachedFile(place('p1'), story, 'vi')).toBeNull();
  });

  it('keeps its index across launches, and touches a file each time it plays', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const first = await cache();
    await first.downloadToCache(place('p1'), audio('a'), 'en');
    await flush();
    const relaunched = await cache();
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    expect(await relaunched.cachedFile(place('p1'), audio('a'), 'en')).not.toBeNull();
    await flush();
    expect(JSON.parse(kv.items.get('wayfare.audioCache')!)).toEqual([
      { lang: 'en', placeId: 'p1', sha256: sha('a'), lastPlayed: 5_000 },
    ]);
    vi.restoreAllMocks();
  });

  it('forgets an entry whose file is gone', async () => {
    const { cachedFile, downloadToCache } = await cache();
    await downloadToCache(place('p1'), audio('a'), 'en');
    files.existing.clear();
    expect(await cachedFile(place('p1'), audio('a'), 'en')).toBeNull();
    await flush();
    expect(JSON.parse(kv.items.get('wayfare.audioCache')!)).toEqual([]);
  });

  it('refuses a download that doesn’t match its hash, and keeps nothing of it', async () => {
    const { cachedFile, downloadToCache } = await cache();
    const wrong = { ...audio('a'), sha256: sha('something else') };
    await expect(downloadToCache(place('p1'), wrong, 'en')).rejects.toThrow('does not match');
    expect(files.existing.size).toBe(0);
    expect(await cachedFile(place('p1'), wrong, 'en')).toBeNull();
  });

  it('replaces a Place’s older audio in the same language', async () => {
    const { cachedFile, downloadToCache } = await cache();
    await downloadToCache(place('p1'), audio('v1'), 'en');
    await downloadToCache(place('p1'), audio('v1'), 'en');
    await downloadToCache(place('p1'), audio('v2'), 'en');
    expect(await cachedFile(place('p1'), audio('v1'), 'en')).toBeNull();
    expect(await cachedFile(place('p1'), audio('v2'), 'en')).not.toBeNull();
  });

  it('keeps at most three languages, dropping the least recently played, never the one heard', async () => {
    const { cachedFile, downloadToCache } = await cache();
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    for (const lang of ['en', 'vi', 'ja', 'ko'] as const)
      await downloadToCache(place('p1'), audio(`story-${lang}`), lang);
    expect(files.existing.has(fileOf('en', 'p1', 'story-en'))).toBe(false);
    expect(await cachedFile(place('p1'), audio('story-en'), 'en')).toBeNull();
    expect(await cachedFile(place('p1'), audio('story-ko'), 'ko')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('carries on when an evicted file can’t be deleted', async () => {
    const { downloadToCache } = await cache();
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    await downloadToCache(place('p1'), audio('story-en'), 'en');
    files.undeletable.add(fileOf('en', 'p1', 'story-en'));
    for (const lang of ['vi', 'ja', 'ko'] as const)
      await downloadToCache(place('p1'), audio(`story-${lang}`), lang);
    expect(files.existing.has(fileOf('ko', 'p1', 'story-ko'))).toBe(true);
    vi.restoreAllMocks();
  });

  it('starts empty when its stored index can’t be read', async () => {
    kv.items.set('wayfare.audioCache', '{broken');
    const { cachedFile } = await cache();
    expect(await cachedFile(place('p1'), audio('a'), 'en')).toBeNull();
    kv.failing = true;
    const unavailable = await cache();
    expect(await unavailable.cachedFile(place('p1'), audio('a'), 'en')).toBeNull();
  });

  it('forgets every cached narration and its index (Forget this install)', async () => {
    const { cachedFile, clearAudioCache, downloadToCache } = await cache();
    await clearAudioCache();
    await downloadToCache(place('p1'), audio('a'), 'en');
    await clearAudioCache();
    expect(files.existing.size).toBe(0);
    expect(kv.items.has('wayfare.audioCache')).toBe(false);
    expect(await cachedFile(place('p1'), audio('a'), 'en')).toBeNull();
  });
});
