import { isSupportedLanguage } from '@wayfare/contracts';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Network from 'expo-network';
import { databaseReady } from '../data/boot';
import { clearAudioCache } from '../data/audio-cache';
import { queryClient } from '../state/query-client';
import { LOCAL_QUERY_KEY } from '../data/hooks';
import { activateSnapshot, recordsOfSnapshot } from './activate';
import { FetchError } from './engine';
import type { EngineDeps, FetchFailure, NetworkKind, Progress } from './engine';
import { areaFolder, ensureFolderOf, packFile } from './files';
import { usePackHolds } from './holds';
import { pruneFiles } from './updates';
import type { Database } from '../db/database';

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** What a failed transfer was, from the native error's words ("HTTP 503", a refused connection…). */
export function failureOf(error: unknown, aborted: boolean): FetchFailure {
  if (aborted) return 'aborted';
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP (\d{3})/.exec(message)?.[1];
  if (status !== undefined) return status.startsWith('5') ? 'server' : 'missing';
  if (/ENOSPC|No space left/i.test(message)) return 'space';
  if (/cancel/i.test(message)) return 'aborted';
  return 'network';
}

/** The network as the download sees it; Diagnostics can report mobile data (K23). */
export async function networkKind(): Promise<NetworkKind> {
  const state = await Network.getNetworkStateAsync();
  if (state.isConnected !== true) return 'none';
  if (usePackHolds.getState().mobileData) return 'cellular';
  return state.type === Network.NetworkStateType.CELLULAR ? 'cellular' : 'wifi';
}

/** Free bytes, or Diagnostics' reported number (K23). */
export function freeBytes(): number {
  const reported = usePackHolds.getState().freeMb;
  return reported === null ? Paths.availableDiskSpace : reported * 1_000_000;
}

/** Wayfare's own caches, cleared without asking before a download is refused for space (K7). */
export async function clearOwnCaches(): Promise<void> {
  await Image.clearDiskCache().catch(() => false);
  await clearAudioCache();
}

/**
 * The app's side of the download. The archive comes through a `DownloadTask`, which resumes a
 * partial file by a `Range` request — after a pause or a kill alike, since Android's resume data is
 * only the bytes already on disk; every other file through `downloadFileAsync`.
 */
export function engineDeps(
  db: Database,
  on: {
    changed: EngineDeps['changed'];
    progress: (areaId: string, lang: string, p: Progress) => void;
  },
): EngineDeps {
  return {
    db,
    async fetchFile(file, temp, onBytes, signal) {
      ensureFolderOf(file.areaId, temp);
      const target = packFile(file.areaId, temp);
      const partial = target.exists ? target.size : 0;
      const archive = file.kind === 'map' && file.name.endsWith('.pmtiles');
      try {
        if (archive) {
          const task =
            partial > 0
              ? DownloadTask.fromSavable(
                  {
                    url: file.url,
                    fileUri: target.uri,
                    isDirectory: false,
                    resumeData: String(partial),
                  },
                  { onProgress: ({ bytesWritten }) => onBytes(bytesWritten) },
                )
              : new DownloadTask(file.url, target, {
                  onProgress: ({ bytesWritten }) => onBytes(bytesWritten),
                });
          const abort = () => void task.pauseAsync().catch(() => undefined);
          signal.addEventListener('abort', abort);
          try {
            const done = partial > 0 ? await task.resumeAsync() : await task.downloadAsync();
            if (done === null) throw new FetchError('aborted');
          } finally {
            signal.removeEventListener('abort', abort);
          }
        } else {
          if (target.exists) target.delete();
          await File.downloadFileAsync(file.url, target, {
            onProgress: ({ bytesWritten }) => onBytes(bytesWritten),
            signal,
          });
        }
      } catch (error) {
        if (error instanceof FetchError) throw error;
        throw new FetchError(failureOf(error, signal.aborted));
      }
    },
    async hashOf(areaId, name) {
      // The native digest over the whole file: measured on the phone, the archive (under 60 MB)
      // hashes in milliseconds; streaming is the upgrade only if memory ever fails.
      const bytes = await packFile(areaId, name).bytes();
      return toHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
    },
    async move(areaId, from, to) {
      ensureFolderOf(areaId, to);
      const target = packFile(areaId, to);
      if (target.exists) target.delete();
      await packFile(areaId, from).move(target);
    },
    remove(areaId, name) {
      const file = packFile(areaId, name);
      if (file.exists) file.delete();
    },
    network: networkKind,
    freeBytes,
    clearCaches: clearOwnCaches,
    async activate(pack, files) {
      const places = files.find((file) => file.kind === 'places' && file.lang === pack.lang);
      if (places === undefined || !isSupportedLanguage(pack.lang)) return;
      const records = recordsOfSnapshot(await packFile(pack.areaId, places.name).bytes());
      await activateSnapshot(await databaseReady, {
        areaId: pack.areaId,
        lang: pack.lang,
        datasetVersion: pack.datasetVersion,
        records,
        now: Date.now(),
      });
      // What no record of this snapshot names goes: an update's replaced and removed files.
      for (const file of await pruneFiles(db, pack, records, places.name)) {
        const onDisk = packFile(pack.areaId, file.name);
        if (onDisk.exists) onDisk.delete();
      }
      const oldMaps = new Directory(areaFolder(pack.areaId), 'map');
      if (oldMaps.exists) {
        for (const entry of oldMaps.list()) {
          if (entry.name !== String(pack.mapPackVersion)) entry.delete();
        }
      }
      await queryClient.invalidateQueries({ queryKey: LOCAL_QUERY_KEY });
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    holds: () => {
      const { slow, failNext } = usePackHolds.getState();
      return { slow, failNext };
    },
    clearFailNext: () => usePackHolds.setState({ failNext: false }),
    changed: on.changed,
    progress: on.progress,
  };
}
