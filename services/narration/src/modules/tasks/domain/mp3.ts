/**
 * MPEG audio Layer III, read from frame headers (our own parser: the common libraries are ESM-only,
 * ADR 0058). Enough to measure a file, name its bitrate, and join chunk files into one.
 */

const MPEG1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Readonly<Record<'1' | '2' | '2.5', readonly number[]>> = {
  '1': [44_100, 48_000, 32_000],
  '2': [22_050, 24_000, 16_000],
  '2.5': [11_025, 12_000, 8_000],
};

/** One Layer III frame. */
export interface Mp3Frame {
  readonly offset: number;
  readonly length: number;
  readonly durationMs: number;
  readonly bitrateKbps: number;
  readonly sampleRate: number;
  /** A Xing/Info (VBR header) frame: metadata, not audio. */
  readonly isInfoFrame: boolean;
}

/** The outcome of reading a file. */
export type Mp3Parse =
  | { readonly ok: true; readonly frames: readonly Mp3Frame[] }
  | { readonly ok: false; readonly reason: string };

/** Where the audio starts: after an ID3v2 tag when there is one. */
function audioStart(data: Buffer): number {
  if (data.length < 10 || data.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size =
    ((data[6]! & 0x7f) << 21) |
    ((data[7]! & 0x7f) << 14) |
    ((data[8]! & 0x7f) << 7) |
    (data[9]! & 0x7f);
  const footer = (data[5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/** Where the audio ends: before an ID3v1 tag when there is one. */
function audioEnd(data: Buffer): number {
  return data.length >= 128 &&
    data.toString('latin1', data.length - 128, data.length - 125) === 'TAG'
    ? data.length - 128
    : data.length;
}

/** Every frame, or why the bytes are not a Layer III stream. */
export function parseMp3(data: Buffer): Mp3Parse {
  const frames: Mp3Frame[] = [];
  const end = audioEnd(data);
  let offset = audioStart(data);
  while (offset + 4 <= end) {
    const b1 = data[offset + 1]!;
    const b2 = data[offset + 2]!;
    const b3 = data[offset + 3]!;
    if (data[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      return { ok: false, reason: `no frame sync at byte ${offset}` };
    }
    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    if (versionBits === 0x01 || layerBits !== 0x01) {
      return { ok: false, reason: `not Layer III at byte ${offset}` };
    }
    const version = versionBits === 0x03 ? '1' : versionBits === 0x02 ? '2' : '2.5';
    const bitrateKbps = (version === '1' ? MPEG1_KBPS : MPEG2_KBPS)[(b2 >> 4) & 0x0f];
    const sampleRate = SAMPLE_RATES[version][(b2 >> 2) & 0x03];
    if (!bitrateKbps || !sampleRate) return { ok: false, reason: `bad header at byte ${offset}` };
    const padding = (b2 >> 1) & 0x01;
    const samples = version === '1' ? 1152 : 576;
    const length = Math.floor(((samples / 8) * bitrateKbps * 1000) / sampleRate) + padding;
    if (offset + length > end) return { ok: false, reason: `truncated frame at byte ${offset}` };
    const mono = ((b3 >> 6) & 0x03) === 0x03;
    const sideInfo = version === '1' ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tag = data.toString('latin1', offset + 4 + sideInfo, offset + 8 + sideInfo);
    frames.push({
      offset,
      length,
      durationMs: (samples / sampleRate) * 1000,
      bitrateKbps,
      sampleRate,
      isInfoFrame: frames.length === 0 && (tag === 'Xing' || tag === 'Info'),
    });
    offset += length;
  }
  if (frames.length === 0) return { ok: false, reason: 'no frames' };
  return { ok: true, frames };
}

/** The playing time of the audio frames, in whole milliseconds. */
export function mp3DurationMs(frames: readonly Mp3Frame[]): number {
  return Math.round(
    frames.filter((frame) => !frame.isInfoFrame).reduce((sum, frame) => sum + frame.durationMs, 0),
  );
}

/**
 * A Xing/Info frame for `audio` (frames in file order, `audioBytes` long): the frame count, the
 * byte count and, when the frame has room, the 100-point table of contents. Without it a player
 * cannot tell how long a raw MP3 is or where to seek in it — the notification's slider and the
 * app's scrubber move the sound forward or not at all. `Info` marks a constant bitrate, `Xing` a
 * variable one. Null when the first frame is too small to hold even the counts.
 */
export function infoFrame(audio: readonly Mp3Frame[], header: Buffer, audioBytes: number) {
  const first = audio[0];
  if (first === undefined) return null;
  const out = Buffer.alloc(first.length);
  header.copy(out, 0, 0, 4);
  const versionBits = (header[1]! >> 3) & 0x03;
  const mono = ((header[3]! >> 6) & 0x03) === 0x03;
  const sideInfo = versionBits === 0x03 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const crc = (header[1]! & 0x01) === 0 ? 2 : 0;
  const at = 4 + crc + sideInfo;
  const withToc = at + 16 + 100 <= first.length;
  if (at + 16 > first.length) return null;
  const constant = audio.every((frame) => frame.bitrateKbps === first.bitrateKbps);
  out.write(constant ? 'Info' : 'Xing', at, 'latin1');
  out.writeUInt32BE(withToc ? 0x07 : 0x03, at + 4);
  out.writeUInt32BE(audio.length, at + 8);
  out.writeUInt32BE(audioBytes + first.length, at + 12);
  if (withToc) {
    const total = audio.reduce((sum, frame) => sum + frame.durationMs, 0);
    let elapsed = 0;
    let bytes = 0;
    let index = 0;
    for (let point = 0; point < 100; point += 1) {
      while (
        index < audio.length - 1 &&
        elapsed + audio[index]!.durationMs <= (point / 100) * total
      ) {
        elapsed += audio[index]!.durationMs;
        bytes += audio[index]!.length;
        index += 1;
      }
      out[at + 16 + point] = Math.min(255, Math.round((256 * bytes) / audioBytes));
    }
  }
  return out;
}

/**
 * One file from several chunk files of the same format: each chunk's ID3 tags and Xing/Info frame
 * are dropped, the audio frames concatenated, and one fresh Info frame put in front so any player
 * can seek. Returns the file and its duration.
 */
export function joinMp3(
  parts: readonly Buffer[],
): { ok: true; data: Buffer; durationMs: number } | { ok: false; reason: string } {
  const pieces: Buffer[] = [];
  const kept: Mp3Frame[] = [];
  for (const [index, part] of parts.entries()) {
    const parsed = parseMp3(part);
    if (!parsed.ok) return { ok: false, reason: `chunk ${index}: ${parsed.reason}` };
    for (const frame of parsed.frames) {
      if (frame.isInfoFrame) continue;
      pieces.push(part.subarray(frame.offset, frame.offset + frame.length));
      kept.push(frame);
    }
  }
  if (kept.length === 0) return { ok: false, reason: 'no audio frames' };
  const audio = Buffer.concat(pieces);
  const header = pieces[0]!.subarray(0, 4);
  const info = infoFrame(kept, header, audio.length);
  return {
    ok: true,
    data: info === null ? audio : Buffer.concat([info, audio]),
    durationMs: mp3DurationMs(kept),
  };
}
