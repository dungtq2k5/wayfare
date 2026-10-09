import type { Language } from '@wayfare/contracts';
import { NARRATION_CONFIG } from '@wayfare/contracts';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { cacheFileName, evictions } from './cache-policy';
import type { CacheEntry } from './cache-policy';
import type { PlaceAudio, PlayerPlace } from './types';

const INDEX_KEY = 'wayfare.audioCache';

/** The index in memory, read from storage once: a cache hit must not wait on a database. */
let index: CacheEntry[] | null = null;

async function entries(): Promise<CacheEntry[]> {
  if (index !== null) return index;
  try {
    const raw = await Storage.getItemAsync(INDEX_KEY);
    index = raw === null ? [] : (JSON.parse(raw) as CacheEntry[]);
  } catch {
    index = [];
  }
  return index;
}

function persist(): void {
  Storage.setItemAsync(INDEX_KEY, JSON.stringify(index ?? [])).catch(() => undefined);
}

const folder = (lang: string) => new Directory(Paths.document, 'narration', lang);
const fileOf = (entry: CacheEntry) => new File(folder(entry.lang), cacheFileName(entry));

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** The cached file's uri, or null. A hit is not hashed again: it was verified when it arrived. */
export async function cachedFile(
  place: PlayerPlace,
  audio: PlaceAudio,
  lang: Language,
): Promise<string | null> {
  const list = await entries();
  const entry = list.find(
    (candidate) =>
      candidate.lang === lang &&
      candidate.placeId === place.id &&
      candidate.sha256 === audio.sha256,
  );
  if (entry === undefined) return null;
  const file = fileOf(entry);
  if (!file.exists) {
    index = list.filter((candidate) => candidate !== entry);
    persist();
    return null;
  }
  index = list.map((candidate) =>
    candidate === entry ? { ...candidate, lastPlayed: Date.now() } : candidate,
  );
  persist();
  return file.uri;
}

/** Downloads a narration into the cache and checks it against its hash; throws on a mismatch. */
export async function downloadToCache(
  place: PlayerPlace,
  audio: PlaceAudio,
  lang: Language,
): Promise<string> {
  const entry: CacheEntry = {
    lang,
    placeId: place.id,
    sha256: audio.sha256,
    lastPlayed: Date.now(),
  };
  folder(lang).create({ idempotent: true, intermediates: true });
  const target = fileOf(entry);
  if (target.exists) target.delete();
  const downloaded = await File.downloadFileAsync(audio.url, target);
  const actual = toHex(await digest(CryptoDigestAlgorithm.SHA256, await downloaded.bytes()));
  if (actual !== audio.sha256) {
    downloaded.delete();
    throw new Error('The narration file does not match its hash');
  }
  const list = (await entries()).filter(
    (candidate) => !(candidate.lang === lang && candidate.placeId === place.id),
  );
  const all = [...list, entry];
  const doomed = evictions(all, lang, {
    filesPerLanguage: NARRATION_CONFIG.audioCacheFilesPerLanguage,
    maxLanguages: NARRATION_CONFIG.audioCacheMaxLanguages,
  });
  for (const old of doomed) {
    try {
      const file = fileOf(old);
      if (file.exists) file.delete();
    } catch {
      // A file already gone is the goal.
    }
  }
  index = all.filter((candidate) => !doomed.includes(candidate));
  persist();
  return downloaded.uri;
}

/** *Forget this install*: every cached narration and the index. */
export async function clearAudioCache(): Promise<void> {
  const root = new Directory(Paths.document, 'narration');
  if (root.exists) root.delete();
  index = [];
  await Storage.removeItemAsync(INDEX_KEY);
}
