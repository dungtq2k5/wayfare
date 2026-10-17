import { describe, expect, it, vi } from 'vitest';

vi.mock('../data/boot', () => ({ databaseReady: new Promise(() => undefined) }));
vi.mock('./files', () => ({ packFile: () => ({ uri: 'file:///never' }) }));

const { packAudioUri, usePackIndex } = await import('./use-pack-files');

describe('a pack file matched by hash', () => {
  it('plays a story from the pack only while the record names that file', () => {
    usePackIndex.setState({ audio: new Map([['a'.repeat(64), 'file:///packs/x/en/audio/a.mp3']]) });
    expect(packAudioUri('a'.repeat(64))).toBe('file:///packs/x/en/audio/a.mp3');
    // A story changed by sync since the pack: its new hash is not in the pack, so it streams.
    expect(packAudioUri('b'.repeat(64))).toBeNull();
  });
});
