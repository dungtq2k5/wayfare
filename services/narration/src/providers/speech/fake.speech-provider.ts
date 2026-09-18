import { SpeechProvider } from './speech-provider';
import type { VoiceSpec } from './speech-provider';

/** MPEG-2 Layer III, 32 kbps, 24 kHz, mono, no CRC: one 96-byte frame is 24 ms. */
const SILENT_FRAME = Buffer.concat([Buffer.from([0xff, 0xf3, 0x44, 0xc0]), Buffer.alloc(92)]);

/** How long the fake speaks per character of SSML. */
export const FAKE_MS_PER_CHAR = 60;

/** A valid MP3 of silence lasting about `ms` milliseconds, in whole frames. */
export function silentMp3(ms: number): Buffer {
  const frames = Math.max(1, Math.ceil(ms / 24));
  return Buffer.concat(Array.from({ length: frames }, () => SILENT_FRAME));
}

/**
 * The local and test default: a real MP3 stream of silent frames whose length follows the SSML, so
 * chunking, joining, duration, size and hashing run for real. Fails every call when told to.
 */
export class FakeSpeechProvider extends SpeechProvider {
  readonly name = 'fake' as const;
  readonly format = 'mp3_24khz_32kbps_mono';
  readonly maxInputBytes: number;

  constructor(
    private readonly failing = false,
    options: { maxInputBytes?: number } = {},
  ) {
    super();
    this.maxInputBytes = options.maxInputBytes ?? 5_000;
  }

  listVoices(languageCode: string): Promise<VoiceSpec[]> {
    return Promise.resolve([{ id: `fake-${languageCode}`, languageCode }]);
  }

  synthesize(input: { ssml: string; voice: VoiceSpec }): Promise<Buffer> {
    if (this.failing) return Promise.reject(new Error('fake speech failure'));
    if (Buffer.byteLength(input.ssml, 'utf8') > this.maxInputBytes) {
      return Promise.reject(new Error('input over the fake limit'));
    }
    return Promise.resolve(silentMp3(input.ssml.length * FAKE_MS_PER_CHAR));
  }
}
