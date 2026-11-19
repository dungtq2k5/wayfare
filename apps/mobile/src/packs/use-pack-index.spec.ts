// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../testing/render-hook';
import type { Pack } from './db';
import type { PackFile } from './plan';

vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);
vi.mock('../data/boot', async () => {
  const { openTestDatabase } = await import('../db/test-database');
  const { migrate } = await import('../db/migrate');
  const db = openTestDatabase();
  await migrate(db);
  return { databaseReady: Promise.resolve(db) };
});

const { refreshPackIndex, usePackIndex, usePhotoUri } = await import('./use-pack-files');
const { addFiles, savePack, setVerified } = await import('./db');
const db = await (await import('../data/boot')).databaseReady;

const map = {
  version: 2,
  folder: 'map/2',
  style: 'map/2/style.json',
  styleDark: null,
  prefixUrl: 'x',
};
const pack = (fields: Partial<Pack>): Pack => ({
  areaId: 'a1',
  lang: 'en',
  state: 'ready',
  datasetVersion: 1,
  mapPackVersion: 2,
  bytes: 0,
  wifiOnly: true,
  installedAt: null,
  updatedAt: null,
  error: null,
  update: null,
  map,
  ...fields,
});
const file = (fields: Partial<PackFile>): PackFile => ({
  areaId: 'a1',
  lang: 'en',
  kind: 'photo',
  name: 'photos/p.jpg',
  url: 'u',
  sha256: 'p',
  bytes: 1,
  placeId: null,
  verified: false,
  ...fields,
});

describe('what the packs in use hold (K12, K13)', () => {
  it('indexes the verified photos and stories, and each area’s map from any language’s pack', async () => {
    await savePack(db, pack({}));
    await savePack(db, pack({ lang: 'vi' }));
    await savePack(db, pack({ areaId: 'a2', state: 'downloading' }));
    await savePack(db, pack({ areaId: 'a3', map: null }));
    const files = [
      file({ lang: '' }),
      file({ kind: 'audio', name: 'en/audio/s.mp3', sha256: 's' }),
      file({ kind: 'audio', name: 'en/audio/u.mp3', sha256: 'u' }),
      file({ kind: 'map', lang: '', name: 'map/2/style.json', sha256: 'm' }),
    ];
    await addFiles(db, files);
    for (const verified of files.slice(0, 2).concat(files[3]!))
      await setVerified(db, verified, true);
    await refreshPackIndex();
    const index = usePackIndex.getState();
    expect([...index.photos]).toEqual([['p', 'file:///doc/packs/a1/photos/p.jpg']]);
    expect([...index.audio]).toEqual([['s', 'file:///doc/packs/a1/en/audio/s.mp3']]);
    expect([...index.areas.keys()]).toEqual(['a1']);
    expect(index.areas.get('a1')?.lang).toBe('en');
  });

  it('shows a photo from a pack when one holds its hash, else its URL', async () => {
    usePackIndex.setState({ photos: new Map([['p', 'file:///local.jpg']]) });
    const local = await renderHook(() => usePhotoUri('https://x/p.jpg', 'p'));
    const remote = await renderHook(() => usePhotoUri('https://x/q.jpg', 'q'));
    const unhashed = await renderHook(() => usePhotoUri('https://x/r.jpg'));
    expect(local.current()).toBe('file:///local.jpg');
    expect(remote.current()).toBe('https://x/q.jpg');
    expect(unhashed.current()).toBe('https://x/r.jpg');
    act(() => usePackIndex.setState({ photos: new Map([['q', 'file:///q.jpg']]) }));
    expect(remote.current()).toBe('file:///q.jpg');
  });
});
