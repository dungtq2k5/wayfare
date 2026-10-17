import type { Database } from '../db/database';
import type { Pack, PackState } from './db';
import { filesOfPack, packOfArea, setPackState, setVerified } from './db';
import type { FileKind, PackFile } from './plan';
import { inOrder } from './plan';

/** Why a file did not arrive. */
export type FetchFailure = 'network' | 'server' | 'missing' | 'space' | 'aborted';

/** A failed fetch, classified so the download knows what state it leads to. */
export class FetchError extends Error {
  constructor(readonly failure: FetchFailure) {
    super(failure);
    this.name = 'FetchError';
  }
}

/** The network as K6 sees it. */
export type NetworkKind = 'wifi' | 'cellular' | 'none';

/** What the download needs from the phone; the app's are in `engine-deps.ts`, the specs' are fakes. */
export interface EngineDeps {
  readonly db: Database;
  /** Fetches `file` to `temp` (a name under the area's folder), resuming a partial `temp`. */
  fetchFile(
    file: PackFile,
    temp: string,
    onBytes: (received: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** The SHA-256 of a file under the area's folder, as lowercase hex. */
  hashOf(areaId: string, name: string): Promise<string>;
  move(areaId: string, from: string, to: string): Promise<void>;
  remove(areaId: string, name: string): void;
  network(): Promise<NetworkKind>;
  /** Free bytes on the phone. */
  freeBytes(): number;
  /** Wayfare's own caches, cleared without asking before a download is refused for space. */
  clearCaches(): Promise<void>;
  /** Checking: the snapshot into the synced Places (K4). */
  activate(pack: Pack, files: readonly PackFile[]): Promise<void>;
  wait(ms: number): Promise<void>;
  now(): number;
  /** Diagnostics' switches (K23). */
  holds(): { slow: boolean; failNext: boolean };
  clearFailNext(): void;
  /** A pack's state or files changed: the screens read them again. */
  changed(areaId: string, lang: string): void;
  /** The download's live progress. */
  progress(areaId: string, lang: string, progress: Progress): void;
}

/** What frame D2's bar and words show. */
export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly stage: FileKind | 'checking';
}

/** How much more than the remaining bytes must be free before a download starts (K7). */
// ponytail: a fixed 10 % margin; measure the phone's real overhead if a full phone is reported.
export const SPACE_MARGIN = 1.1;
/** The back-off between `5xx` answers, before the third fails the pack (K8). */
export const SERVER_BACKOFF_MS = [2_000, 4_000, 8_000] as const;
/** *Slow downloads* (K23): the first files of a run each wait this long, and so does checking. */
export const SLOW_FILES = 10;
export const SLOW_FILE_MS = 3_000;
/** …and checking this long, so its *Cancel* can be reached at the flows' pace (edge 1). */
export const SLOW_CHECKING_MS = 8_000;
/** Progress is written at most this often (K3). */
export const PROGRESS_EVERY_MS = 1_000;

const temporaryName = (file: PackFile) => `${file.name}.part`;

/**
 * Runs one pack's download from its first unverified file — so a relaunch, a pause or a dropped
 * connection goes on from there (K9) — in the product's order, one file at a time.
 * ponytail: one file at a time; parallel photos if the photo stage is slow on a real network.
 * Each file arrives under a temporary name and is renamed only when its SHA-256 matches; a
 * mismatch is fetched once more, then the pack fails (K8). When every file is verified, the pack
 * is checked and activated (K4). Returns the state the pack ended in.
 */
export async function runDownload(
  deps: EngineDeps,
  areaId: string,
  lang: string,
  signal: AbortSignal,
): Promise<PackState> {
  const { db } = deps;
  const stop = async (state: PackState, error: string | null = null): Promise<PackState> => {
    // A pause or a cancel already wrote its own state: the run only ends.
    if (signal.aborted) return (await packOfArea(db, areaId, lang))?.state ?? 'paused';
    await setPackState(db, areaId, lang, state, error);
    deps.changed(areaId, lang);
    return state;
  };
  const pack = await packOfArea(db, areaId, lang);
  if (pack === null) return 'failed';

  // Asked before every file, not only at the start: Wi-Fi dropping midway leaves the phone on
  // mobile data, which raises no error, so a Wi-Fi-only download would go on over it.
  // ponytail: the file in flight finishes on mobile data; abort it too if large files make that costly.
  const offNetwork = async (): Promise<PackState | null> => {
    const network = await deps.network();
    if (network === 'none') return 'waiting-connection';
    if (network === 'cellular' && pack.wifiOnly) return 'waiting-wifi';
    return null;
  };
  const before = await offNetwork();
  if (before !== null) return stop(before);

  const files = await filesOfPack(db, areaId, lang);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let done = files.filter((file) => file.verified).reduce((sum, file) => sum + file.bytes, 0);
  const pending = inOrder(files.filter((file) => !file.verified));
  const remaining = () => total - done;

  if (deps.freeBytes() < remaining() * SPACE_MARGIN) {
    await deps.clearCaches();
    if (deps.freeBytes() < remaining() * SPACE_MARGIN) return stop('no-space');
  }
  await setPackState(db, areaId, lang, 'downloading');
  deps.changed(areaId, lang);

  let lastProgress = 0;
  const report = (received: number, stage: Progress['stage'], force = false) => {
    const now = deps.now();
    if (!force && now - lastProgress < PROGRESS_EVERY_MS) return;
    lastProgress = now;
    deps.progress(areaId, lang, { done: done + received, total, stage });
  };

  let slowLeft = deps.holds().slow ? SLOW_FILES : 0;
  for (const file of pending) {
    if (signal.aborted) return stop('paused');
    // Midway, the free space falling under what is left is the phone being full (frame D7b).
    if (deps.freeBytes() < remaining()) return stop('no-space');
    const off = await offNetwork();
    if (off !== null) return stop(off);
    report(0, file.kind, true);
    if (slowLeft > 0) {
      slowLeft -= 1;
      await deps.wait(SLOW_FILE_MS);
    }
    const temp = temporaryName(file);
    let mismatches = 0;
    let serverErrors = 0;
    for (;;) {
      if (signal.aborted) return stop('paused');
      try {
        await deps.fetchFile(file, temp, (received) => report(received, file.kind), signal);
      } catch (error) {
        const failure = error instanceof FetchError ? error.failure : 'network';
        if (failure === 'aborted') return stop('paused');
        if (failure === 'network') return stop('waiting-connection');
        if (failure === 'space') return stop('no-space');
        if (failure === 'missing') return stop('failed', 'missing');
        serverErrors += 1;
        if (serverErrors >= SERVER_BACKOFF_MS.length) return stop('failed', 'server');
        await deps.wait(SERVER_BACKOFF_MS[serverErrors - 1]!);
        continue;
      }
      let hash = await deps.hashOf(areaId, temp);
      if (deps.holds().failNext) hash = 'failed-on-purpose';
      if (hash === file.sha256) {
        await deps.move(areaId, temp, file.name);
        await setVerified(db, file, true);
        done += file.bytes;
        break;
      }
      deps.remove(areaId, temp);
      mismatches += 1;
      if (mismatches >= 2) {
        deps.clearFailNext();
        return stop('failed', 'check');
      }
    }
  }

  if (signal.aborted) return stop('paused');
  await setPackState(db, areaId, lang, 'checking');
  deps.changed(areaId, lang);
  report(0, 'checking', true);
  // *Slow downloads* holds checking too, so frame D4 and its *Cancel* can be asserted (edge 1).
  if (deps.holds().slow) await deps.wait(SLOW_CHECKING_MS);
  const checked = await packOfArea(db, areaId, lang);
  if (checked === null || signal.aborted) return checked?.state ?? 'paused';
  await deps.activate(checked, await filesOfPack(db, areaId, lang));
  if (signal.aborted) return (await packOfArea(db, areaId, lang))?.state ?? 'paused';
  const now = deps.now();
  await db.run(
    `UPDATE packs SET state = 'ready', error = NULL, update_json = NULL,
       installed_at = COALESCE(installed_at, ?), updated_at = ? WHERE area_id = ? AND lang = ?`,
    [now, now, areaId, lang],
  );
  deps.changed(areaId, lang);
  return 'ready';
}
