import { SpeechProvider } from './speech-provider';
import type { VoiceSpec } from './speech-provider';
import { FAKE_SPEECH_FAILS_MARKER, fakeFailureError } from '../fake-failure';
import type { FakeFailure } from '../fake-failure';

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
 * chunking, joining, duration, size and hashing run for real. Fails every call when told to, or is
 * out of reach; fails one text holding `FAKE_SPEECH_FAILS_MARKER`.
 */
export class FakeSpeechProvider extends SpeechProvider {
  readonly name = 'fake' as const;
  readonly format = 'mp3_24khz_32kbps_mono';
  readonly maxInputBytes: number;

  constructor(
    private readonly failing: FakeFailure = false,
    options: { maxInputBytes?: number } = {},
  ) {
    super();
    this.maxInputBytes = options.maxInputBytes ?? 5_000;
  }

  listVoices(languageCode: string): Promise<VoiceSpec[]> {
    return Promise.resolve([{ id: `fake-${languageCode}`, languageCode }]);
  }

  synthesize(input: { ssml: string; voice: VoiceSpec }): Promise<Buffer> {
    const failure = fakeFailureError('speech', this.failing);
    if (failure !== null) return Promise.reject(failure);
    if (input.ssml.includes(FAKE_SPEECH_FAILS_MARKER)) {
      return Promise.reject(new Error('fake speech failure (marked text)'));
    }
    if (Buffer.byteLength(input.ssml, 'utf8') > this.maxInputBytes) {
      return Promise.reject(new Error('input over the fake limit'));
    }
    return Promise.resolve(silentMp3(input.ssml.length * FAKE_MS_PER_CHAR));
  }
}
