import type { SpeechProviderName } from '../../config/env.schema';

/** Injection token for the configured speech providers, in order. */
export const SPEECH_PROVIDERS = Symbol('SPEECH_PROVIDERS');

/** One voice: its provider's id, and the language code it speaks. */
export interface VoiceSpec {
  readonly id: string;
  readonly languageCode: string;
  readonly gender?: string;
}

/**
 * Speech synthesis, as narration uses it (ADR 0033). Each provider declares its output format —
 * part of every cache key (rdm-spec N-3) — and the largest `<speak>` document it accepts.
 */
export abstract class SpeechProvider {
  abstract readonly name: SpeechProviderName;
  /** e.g. `mp3_24khz_32kbps_mono`. */
  abstract readonly format: string;
  /** UTF-8 bytes of one `<speak>` document. */
  abstract readonly maxInputBytes: number;
  abstract listVoices(languageCode: string): Promise<VoiceSpec[]>;
  /** One chunk: a complete `<speak>` document. */
  abstract synthesize(input: { ssml: string; voice: VoiceSpec }): Promise<Buffer>;
}
