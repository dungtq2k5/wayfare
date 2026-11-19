import { beforeEach, describe, expect, it, vi } from 'vitest';
import { files } from '../testing/player-fakes';

vi.mock('expo-file-system', () =>
  import('../testing/player-fakes').then((m) => m.fileSystemModule),
);
vi.mock('./generated/notification-artwork', () => ({ NOTIFICATION_ARTWORK_BASE64: btoa('PNG') }));

const artwork = async () => {
  vi.resetModules();
  return (await import('./fallback-artwork')).fallbackArtworkUrl;
};

describe('the media notification’s fallback picture', () => {
  beforeEach(() => {
    files.existing.clear();
    files.failCreate = false;
  });

  it('writes the app icon once, on first use, and answers its file thereafter', async () => {
    const fallbackArtworkUrl = await artwork();
    expect(fallbackArtworkUrl()).toBe('cache:/notification-artwork.png');
    expect(new TextDecoder().decode(files.existing.get('cache:/notification-artwork.png'))).toBe(
      'PNG',
    );
    files.existing.set('cache:/notification-artwork.png', new Uint8Array([1]));
    expect(fallbackArtworkUrl()).toBe('cache:/notification-artwork.png');
    expect(files.existing.get('cache:/notification-artwork.png')).toEqual(new Uint8Array([1]));
  });

  it('reuses the file a previous launch wrote', async () => {
    files.existing.set('cache:/notification-artwork.png', new Uint8Array([7]));
    expect((await artwork())()).toBe('cache:/notification-artwork.png');
    expect(files.existing.get('cache:/notification-artwork.png')).toEqual(new Uint8Array([7]));
  });

  it('answers none when the file can’t be written, and tries again next time', async () => {
    files.failCreate = true;
    const fallbackArtworkUrl = await artwork();
    expect(fallbackArtworkUrl()).toBeUndefined();
    files.failCreate = false;
    expect(fallbackArtworkUrl()).toBe('cache:/notification-artwork.png');
  });
});
