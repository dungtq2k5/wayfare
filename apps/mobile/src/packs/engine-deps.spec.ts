import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pack } from './db';
import type { PackFile } from './plan';

vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (_algorithm: string, bytes: Uint8Array) => Promise.resolve(bytes.buffer),
}));
const native = vi.hoisted(() => {
  const network: { isConnected?: boolean; type: string } = { isConnected: true, type: 'WIFI' };
  return {
    network,
    clearImages: vi.fn(() => Promise.resolve(true)),
    clearAudio: vi.fn(() => Promise.resolve()),
    invalidate: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('expo-network', () => ({
  NetworkStateType: { CELLULAR: 'CELLULAR', WIFI: 'WIFI' },
  getNetworkStateAsync: () => Promise.resolve(native.network),
}));
vi.mock('expo-image', () => ({ Image: { clearDiskCache: native.clearImages } }));
vi.mock('../data/audio-cache', () => ({ clearAudioCache: native.clearAudio }));
vi.mock('../state/query-client', () => ({ queryClient: { invalidateQueries: native.invalidate } }));
vi.mock('../data/hooks', () => ({ LOCAL_QUERY_KEY: ['local'] }));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({ boot: true }) }));
const snapshot = vi.hoisted(() => ({
  records: vi.fn((_bytes: Uint8Array) => [{ id: 'r1' }]),
  activate: vi.fn((_db: unknown, _input: object) => Promise.resolve()),
  prune: vi.fn((_db: unknown, _pack: unknown, _records: unknown, _name: string) =>
    Promise.resolve([] as { name: string }[]),
  ),
}));
vi.mock('./activate', () => ({
  recordsOfSnapshot: snapshot.records,
  activateSnapshot: snapshot.activate,
}));
vi.mock('./updates', () => ({ pruneFiles: snapshot.prune }));

const { clearOwnCaches, engineDeps, failureOf, freeBytes, networkKind } =
  await import('./engine-deps');
const { FetchError } = await import('./engine');
const { disk } = await import('../testing/packs-fakes');
const { usePackHolds } = await import('./holds');

const AREA = 'area-1';
const root = `file:///doc/packs/${AREA}`;
const file = (fields: Partial<PackFile> = {}): PackFile => ({
  areaId: AREA,
  lang: 'en',
  kind: 'audio',
  name: 'en/audio/a.mp3',
  url: 'http://media.test/a.mp3',
  sha256: 'a',
  bytes: 3,
  placeId: null,
  verified: false,
  ...fields,
});
const on = { changed: vi.fn(), progress: vi.fn() };
const deps = () => engineDeps({ app: true } as never, on);
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  disk.reset();
  native.network = { isConnected: true, type: 'WIFI' };
  usePackHolds.setState({ slow: false, freeMb: null, mobileData: false, failNext: false });
});

describe('a failed transfer, from the native error’s words', () => {
  it('names what the download does next', () => {
    expect(failureOf(new Error('x'), true)).toBe('aborted');
    expect(failureOf(new Error('HTTP 503'), false)).toBe('server');
    expect(failureOf(new Error('HTTP 404'), false)).toBe('missing');
    expect(failureOf(new Error('ENOSPC: No space left'), false)).toBe('space');
    expect(failureOf('Cancelled by user', false)).toBe('aborted');
    expect(failureOf(new Error('refused'), false)).toBe('network');
  });
});

describe('the phone as the download sees it', () => {
  it('reads Wi-Fi, mobile data, or no connection, and Diagnostics’ mobile data', async () => {
    expect(await networkKind()).toBe('wifi');
    native.network = { isConnected: true, type: 'CELLULAR' };
    expect(await networkKind()).toBe('cellular');
    native.network = { isConnected: undefined, type: 'WIFI' };
    expect(await networkKind()).toBe('none');
    native.network = { isConnected: true, type: 'WIFI' };
    usePackHolds.setState({ mobileData: true });
    expect(await networkKind()).toBe('cellular');
  });

  it('reads the free space, or the number Diagnostics reports', () => {
    expect(freeBytes()).toBe(5_000_000_000);
    usePackHolds.setState({ freeMb: 12 });
    expect(freeBytes()).toBe(12_000_000);
  });

  it('clears its own caches, even when the image cache refuses', async () => {
    native.clearImages.mockRejectedValueOnce(new Error('busy'));
    await clearOwnCaches();
    expect(native.clearAudio).toHaveBeenCalled();
  });

  it('hands the engine Diagnostics’ switches and clears the next failure', () => {
    usePackHolds.setState({ slow: true, failNext: true });
    const engine = deps();
    expect(engine.holds()).toEqual({ slow: true, failNext: true });
    engine.clearFailNext();
    expect(usePackHolds.getState().failNext).toBe(false);
    expect(engine.network).toBe(networkKind);
    expect(engine.changed).toBe(on.changed);
  });

  it('waits the time it is asked', async () => {
    vi.useFakeTimers();
    try {
      const waited = vi.fn();
      void deps().wait(1_000).then(waited);
      await vi.advanceTimersByTimeAsync(999);
      expect(waited).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(waited).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetching a file', () => {
  it('fetches a file whole, replacing a partial one, with its folder made', async () => {
    disk.files.set(`${root}/en/audio/a.mp3.part`, new Uint8Array(9));
    disk.download = (_url, path, onProgress) => {
      onProgress(3);
      disk.files.set(path, new Uint8Array([7, 7, 7]));
      return Promise.resolve();
    };
    const bytes = vi.fn();
    await deps().fetchFile(file(), 'en/audio/a.mp3.part', bytes, signal());
    expect(disk.folders.has(`${root}/en/audio`)).toBe(true);
    expect(disk.files.get(`${root}/en/audio/a.mp3.part`)).toEqual(new Uint8Array([7, 7, 7]));
    expect(bytes).toHaveBeenCalledWith(3);
  });

  it('fetches the map archive by a resumable task, resuming a partial one from its bytes', async () => {
    const archive = file({ kind: 'map', name: 'map/2/map.pmtiles' });
    const bytes = vi.fn();
    disk.download = (_url, path, onProgress) => {
      onProgress(50);
      disk.files.set(path, new Uint8Array(50));
      return Promise.resolve();
    };
    await deps().fetchFile(archive, 'map/2/map.pmtiles.part', bytes, signal());
    expect(disk.resumedFrom).toEqual([]);
    await deps().fetchFile(archive, 'map/2/map.pmtiles.part', bytes, signal());
    expect(disk.resumedFrom).toEqual(['50']);
    expect(bytes).toHaveBeenCalledWith(50);
  });

  it('pauses the archive’s task on abort, and a task that stops before its end is aborted', async () => {
    const controller = new AbortController();
    disk.download = () => {
      controller.abort();
      return Promise.resolve();
    };
    disk.taskResult = null;
    const fetching = deps().fetchFile(
      file({ kind: 'map', name: 'map/2/map.pmtiles' }),
      'map/2/map.pmtiles.part',
      vi.fn(),
      controller.signal,
    );
    await expect(fetching).rejects.toEqual(new FetchError('aborted'));
    expect(disk.paused).toBe(1);
  });

  it('classifies a native failure, and keeps the engine’s own', async () => {
    disk.download = () => Promise.reject(new Error('HTTP 503'));
    await expect(deps().fetchFile(file(), 'x.part', vi.fn(), signal())).rejects.toEqual(
      new FetchError('server'),
    );
    disk.download = () => Promise.reject(new FetchError('space'));
    await expect(deps().fetchFile(file(), 'x.part', vi.fn(), signal())).rejects.toEqual(
      new FetchError('space'),
    );
  });
});

describe('the files on the phone', () => {
  it('hashes a file’s bytes as hex', async () => {
    disk.files.set(`${root}/f`, new Uint8Array([0, 15, 255]));
    expect(await deps().hashOf(AREA, 'f')).toBe('000fff');
  });

  it('moves a checked file into place, over an older one, and removes a file only once', async () => {
    disk.files.set(`${root}/a.part`, new Uint8Array([1]));
    disk.files.set(`${root}/dir/a`, new Uint8Array([9]));
    const engine = deps();
    await engine.move(AREA, 'a.part', 'dir/a');
    expect(disk.files.get(`${root}/dir/a`)).toEqual(new Uint8Array([1]));
    expect(disk.files.has(`${root}/a.part`)).toBe(false);
    engine.remove(AREA, 'dir/a');
    engine.remove(AREA, 'dir/a');
    expect(disk.files.size).toBe(0);
  });
});

describe('activating a pack', () => {
  const pack = { areaId: AREA, lang: 'en', datasetVersion: 50, mapPackVersion: 3 } as Pack;
  const places = file({ kind: 'places', name: 'en/places.ndjson.gz' });

  it('loads its snapshot, drops what no record names, and the old maps', async () => {
    disk.files.set(`${root}/en/places.ndjson.gz`, new Uint8Array([1]));
    disk.files.set(`${root}/photos/old.jpg`, new Uint8Array([1]));
    disk.folders.add(`${root}/map`);
    disk.folders.add(`${root}/map/2`);
    disk.folders.add(`${root}/map/3`);
    snapshot.prune.mockResolvedValueOnce([{ name: 'photos/old.jpg' }, { name: 'gone.jpg' }]);
    await deps().activate(pack, [file(), places]);
    expect(snapshot.records).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(snapshot.activate).toHaveBeenCalledWith(
      { boot: true },
      expect.objectContaining({
        areaId: AREA,
        lang: 'en',
        datasetVersion: 50,
        records: [{ id: 'r1' }],
      }),
    );
    expect(disk.files.has(`${root}/photos/old.jpg`)).toBe(false);
    expect([...disk.folders].filter((path) => path.startsWith(`${root}/map/`))).toEqual([
      `${root}/map/3`,
    ]);
    expect(native.invalidate).toHaveBeenCalledWith({ queryKey: ['local'] });
  });

  it('activates nothing without the language’s snapshot, or in a language Wayfare lacks', async () => {
    await deps().activate(pack, [file()]);
    await deps().activate({ ...pack, lang: 'xx' }, [{ ...places, lang: 'xx' }]);
    expect(snapshot.activate).not.toHaveBeenCalled();
  });

  it('activates with no old map folder to clear', async () => {
    await deps().activate(pack, [places]);
    expect(native.invalidate).toHaveBeenCalled();
  });
});
