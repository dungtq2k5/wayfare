import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);

const { areaFolder, ensureFolderOf, packFile, packsRoot } = await import('./files');
const { disk } = await import('../testing/packs-fakes');

describe('where a pack’s files live', () => {
  it('keeps every area’s folder under the document directory, which Android never clears', () => {
    expect(packsRoot().uri).toBe('file:///doc/packs');
    expect(areaFolder('a1').uri).toBe('file:///doc/packs/a1');
  });

  it('places a file by its relative name, folders and all', () => {
    expect(packFile('a1', 'map/2/fonts/0-255.pbf').uri).toBe(
      'file:///doc/packs/a1/map/2/fonts/0-255.pbf',
    );
    expect(packFile('a1', 'style.json').uri).toBe('file:///doc/packs/a1/style.json');
  });

  it('makes a file’s folder only when it is missing', () => {
    ensureFolderOf('a1', 'photos/x.jpg');
    expect(disk.folders.has('file:///doc/packs/a1/photos')).toBe(true);
    const before = disk.folders.size;
    ensureFolderOf('a1', 'photos/y.jpg');
    expect(disk.folders.size).toBe(before);
  });
});
