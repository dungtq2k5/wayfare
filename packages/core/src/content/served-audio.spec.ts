import { describe, expect, it } from 'vitest';
import { servedAudio } from './served-audio';

const CURRENT = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const row = {
  sourceContentHash: CURRENT,
  audioStatus: 'READY',
  audioSourceContentHash: CURRENT,
  audioObjectPath: 'audio/x.mp3',
  audioSha256: 'c'.repeat(64),
  audioBytes: 10,
  audioDurationMs: 20,
};

describe('servedAudio', () => {
  it('serves audio made from the text it sits beside', () => {
    expect(servedAudio(row)).toEqual({
      objectPath: 'audio/x.mp3',
      sha256: 'c'.repeat(64),
      bytes: 10,
      durationMs: 20,
    });
  });

  it('keeps matching audio for stale text', () => {
    expect(
      servedAudio({ ...row, sourceContentHash: OLD, audioSourceContentHash: OLD }),
    ).not.toBeNull();
  });

  it('never plays audio made for another text', () => {
    expect(servedAudio({ ...row, audioSourceContentHash: OLD })).toBeNull();
  });

  it.each(['PENDING', 'FAILED'])('serves nothing that is %s', (audioStatus) => {
    expect(servedAudio({ ...row, audioStatus })).toBeNull();
  });

  it('serves nothing without a file, and defaults missing sizes', () => {
    expect(servedAudio({ ...row, audioObjectPath: null })).toBeNull();
    expect(servedAudio({ ...row, audioSha256: null })).toBeNull();
    expect(servedAudio({ ...row, audioBytes: null, audioDurationMs: null })).toMatchObject({
      bytes: 0,
      durationMs: 0,
    });
  });
});
