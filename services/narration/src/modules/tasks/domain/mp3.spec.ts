import { describe, expect, it } from 'vitest';
import { silentMp3 } from '../../../providers/speech/fake.speech-provider';
import { infoFrame as infoFrameFor, joinMp3, mp3DurationMs, parseMp3 } from './mp3';

/** An ID3v2 tag of `size` payload bytes. */
function id3(size: number): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, Buffer.alloc(size)]);
}

/** An MPEG-2 mono frame carrying a Xing tag where the side information ends. */
function infoFrame(): Buffer {
  const frame = Buffer.concat([Buffer.from([0xff, 0xf3, 0x44, 0xc0]), Buffer.alloc(92)]);
  frame.write('Info', 4 + 9, 'latin1');
  return frame;
}

describe('parseMp3', () => {
  it('reads each frame of a known file', () => {
    const parsed = parseMp3(silentMp3(240));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.frames).toHaveLength(10);
    expect(parsed.frames[0]).toMatchObject({
      bitrateKbps: 32,
      sampleRate: 24_000,
      length: 96,
      durationMs: 24,
    });
    expect(mp3DurationMs(parsed.frames)).toBe(240);
  });

  it('reads an MPEG-1 frame at 44.1 kHz with padding', () => {
    // 128 kbps, 44.1 kHz, padded, stereo: 418 bytes.
    const frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x92, 0x00]), Buffer.alloc(414)]);
    const parsed = parseMp3(frame);
    expect(parsed.ok && parsed.frames[0]).toMatchObject({
      bitrateKbps: 128,
      sampleRate: 44_100,
      length: 418,
    });
  });

  it('skips ID3 tags at either end, and refuses what is not Layer III', () => {
    const tagged = Buffer.concat([id3(20), silentMp3(48), Buffer.from('TAG'), Buffer.alloc(125)]);
    const parsed = parseMp3(tagged);
    expect(parsed.ok && parsed.frames.length).toBe(2);
    expect(parseMp3(Buffer.from('not audio at all')).ok).toBe(false);
    expect(parseMp3(silentMp3(48).subarray(0, 150)).ok).toBe(false);
    expect(parseMp3(Buffer.alloc(0)).ok).toBe(false);
  });
});

describe('joinMp3', () => {
  it('joins chunk files, dropping their tags and info frames, and sums the durations', () => {
    const first = Buffer.concat([id3(10), infoFrame(), silentMp3(96)]);
    const second = Buffer.concat([id3(30), silentMp3(48)]);
    const joined = joinMp3([first, second]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.durationMs).toBe(144);
    expect(joined.data.includes(Buffer.from('ID3'))).toBe(false);
    // Six audio frames, behind one fresh info frame of the same size.
    expect(joined.data).toHaveLength(7 * 96);
    const parsed = parseMp3(joined.data);
    expect(parsed.ok && parsed.frames[0]?.isInfoFrame).toBe(true);
    expect(parsed.ok && mp3DurationMs(parsed.frames)).toBe(144);
  });

  it('tells a player the frame and byte counts, so it can seek', () => {
    const joined = joinMp3([silentMp3(240)]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    // MPEG-2 mono: the tag sits after the 4-byte header and 9 bytes of side information.
    const at = 4 + 9;
    expect(joined.data.toString('latin1', at, at + 4)).toBe('Info');
    expect(joined.data.readUInt32BE(at + 4) & 0x03).toBe(0x03);
    expect(joined.data.readUInt32BE(at + 8)).toBe(10);
    expect(joined.data.readUInt32BE(at + 12)).toBe(joined.data.length);
  });

  it('refuses a broken chunk, naming it', () => {
    expect(joinMp3([silentMp3(24), Buffer.from('xx')])).toEqual({
      ok: false,
      reason: 'chunk 1: no frames',
    });
  });
});

/** One MPEG frame: its 4 header bytes, then zeros to the length the header names. */
const frame = (header: number[], length: number) =>
  Buffer.concat([Buffer.from(header), Buffer.alloc(length - 4)]);

describe('parseMp3, the headers it refuses or reads', () => {
  it('skips an ID3v2 tag with a footer as well', () => {
    const tag = id3(6);
    tag[5] = 0x10; // footer present: 10 more bytes after the payload
    const parsed = parseMp3(Buffer.concat([tag, Buffer.alloc(10), silentMp3(24)]));
    expect(parsed.ok && parsed.frames.length).toBe(1);
  });

  it('refuses a reserved version or another layer, and a header naming no bitrate', () => {
    expect(parseMp3(frame([0xff, 0xeb, 0x90, 0x00], 417))).toEqual({
      ok: false,
      reason: 'not Layer III at byte 0',
    });
    expect(parseMp3(frame([0xff, 0xfd, 0x90, 0x00], 417))).toEqual({
      ok: false,
      reason: 'not Layer III at byte 0',
    });
    expect(parseMp3(frame([0xff, 0xfb, 0xf0, 0x00], 417))).toEqual({
      ok: false,
      reason: 'bad header at byte 0',
    });
  });

  it('reads MPEG 2.5, and the side information of mono MPEG-1 and stereo MPEG-2', () => {
    // MPEG 2.5, 8 kbps at 8 kHz: 72 bytes.
    const parsed = parseMp3(frame([0xff, 0xe3, 0x18, 0xc0], 72));
    expect(parsed.ok && parsed.frames[0]).toMatchObject({ sampleRate: 8_000, length: 72 });
    const mono = frame([0xff, 0xfb, 0x90, 0xc0], 417);
    mono.write('Info', 4 + 17, 'latin1');
    const read = parseMp3(mono);
    expect(read.ok && read.frames[0]?.isInfoFrame).toBe(true);
    const stereo = frame([0xff, 0xf3, 0x14, 0x00], 24);
    stereo.write('Xing', 4 + 17, 'latin1');
    expect(parseMp3(stereo).ok).toBe(true);
  });
});

describe('the Info frame a joined file opens with', () => {
  it('is none for no audio, or a first frame too small to hold the counts', () => {
    expect(infoFrameFor([], Buffer.alloc(4), 0)).toBeNull();
    // MPEG-2 stereo, 8 kbps at 24 kHz: 24 bytes, short of the 37 the counts need.
    const tiny = frame([0xff, 0xf3, 0x14, 0x00], 24);
    const joined = joinMp3([Buffer.concat([tiny, tiny])]);
    expect(joined.ok && joined.data).toEqual(Buffer.concat([tiny, tiny]));
  });

  it('carries a table of contents when the frame has room, and says Xing for a variable bitrate', () => {
    // MPEG-1 stereo at 44.1 kHz: 128 kbps (417 bytes), then 160 kbps (522 bytes).
    const joined = joinMp3([
      frame([0xff, 0xfb, 0x90, 0x00], 417),
      frame([0xff, 0xfb, 0xa0, 0x00], 522),
    ]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const at = 4 + 32;
    expect(joined.data.toString('latin1', at, at + 4)).toBe('Xing');
    expect(joined.data.readUInt32BE(at + 4)).toBe(0x07);
    const toc = [...joined.data.subarray(at + 16, at + 116)];
    expect(toc[0]).toBe(0);
    expect(toc.every((byte, i) => i === 0 || byte >= toc[i - 1]!)).toBe(true);
    expect(toc.at(-1)).toBeGreaterThan(0);
  });

  it('leaves room for a CRC after a protected header', () => {
    const joined = joinMp3([frame([0xff, 0xfa, 0x90, 0x00], 417)]);
    expect(joined.ok && joined.data.toString('latin1', 4 + 2 + 32, 4 + 2 + 36)).toBe('Info');
  });

  it('refuses a file of nothing but info frames', () => {
    expect(joinMp3([infoFrame()])).toEqual({ ok: false, reason: 'no audio frames' });
  });
});
