import { describe, expect, it } from 'vitest';
import { cacheFileName, evictions } from './cache-policy';
import type { CacheEntry } from './cache-policy';

const entry = (lang: string, placeId: string, lastPlayed: number): CacheEntry => ({
  lang,
  placeId,
  sha256: 'ab'.repeat(32),
  lastPlayed,
});
const limits = { filesPerLanguage: 2, maxLanguages: 2 };

describe('cacheFileName', () => {
  it('is the Place and the start of the hash, so new audio is a new file', () => {
    expect(cacheFileName({ placeId: 'p1', sha256: 'ab'.repeat(32) })).toBe(
      'p1-abababababababab.mp3',
    );
  });
});

describe('evictions', () => {
  it('keeps everything that fits', () => {
    expect(evictions([entry('en', 'a', 1), entry('vi', 'b', 2)], 'en', limits)).toEqual([]);
  });

  it('drops the least recently played files over the per-language cap', () => {
    const a = entry('en', 'a', 1);
    const b = entry('en', 'b', 2);
    const c = entry('en', 'c', 3);
    expect(evictions([c, a, b], 'en', limits)).toEqual([a]);
  });

  it('drops the least recent language beyond the language cap, never the pinned one', () => {
    const old = entry('ja', 'a', 1);
    const mid = entry('vi', 'b', 5);
    const recent = entry('fr', 'c', 9);
    expect(evictions([old, mid, recent], 'fr', limits)).toEqual([old]);
    // The pinned language is the oldest here and still survives.
    expect(evictions([entry('ja', 'a', 1), mid, recent], 'ja', limits)).toEqual([mid]);
  });
});
