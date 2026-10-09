/** One cached narration file. */
export interface CacheEntry {
  readonly lang: string;
  readonly placeId: string;
  readonly sha256: string;
  /** When it was last played, in ms; the least recent goes first. */
  readonly lastPlayed: number;
}

/** The file's name: Place and hash, so regenerated audio is a new entry; in its language's folder. */
export function cacheFileName(entry: Pick<CacheEntry, 'placeId' | 'sha256'>): string {
  return `${entry.placeId}-${entry.sha256.slice(0, 16)}.mp3`;
}

export interface CacheLimits {
  readonly filesPerLanguage: number;
  readonly maxLanguages: number;
}

/**
 * What to delete so the cache fits the product's limits (§9): at most `filesPerLanguage` per
 * language and `maxLanguages` languages, the least recently played first, and the language being
 * heard pinned — it is never evicted for another's sake.
 */
export function evictions(
  entries: readonly CacheEntry[],
  pinnedLang: string,
  limits: CacheLimits,
): CacheEntry[] {
  const doomed = new Set<CacheEntry>();
  const byLang = new Map<string, CacheEntry[]>();
  for (const entry of entries) byLang.set(entry.lang, [...(byLang.get(entry.lang) ?? []), entry]);

  // Whole languages first: the least recently played one that is not pinned.
  const recency = (list: readonly CacheEntry[]) => Math.max(...list.map((e) => e.lastPlayed));
  const langs = [...byLang.keys()].sort(
    (a, b) => recency(byLang.get(a) ?? []) - recency(byLang.get(b) ?? []),
  );
  let kept = langs.length;
  for (const lang of langs) {
    if (kept <= limits.maxLanguages) break;
    if (lang === pinnedLang) continue;
    for (const entry of byLang.get(lang) ?? []) doomed.add(entry);
    byLang.delete(lang);
    kept -= 1;
  }

  // Then, within each language, the oldest files over the cap.
  for (const list of byLang.values()) {
    const oldestFirst = [...list].sort((a, b) => a.lastPlayed - b.lastPlayed);
    for (const entry of oldestFirst.slice(0, Math.max(0, list.length - limits.filesPerLanguage)))
      doomed.add(entry);
  }
  return [...doomed];
}
