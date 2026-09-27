import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { SpeechProvider } from './speech-provider';
import type { VoiceSpec } from './speech-provider';

/** The part of the Edge client the adapter uses, so a test can stand in for it. */
export interface EdgeClient {
  setMetadata(voice: string, format: OUTPUT_FORMAT): Promise<void>;
  rawToStream(ssml: string): { audioStream: NodeJS.ReadableStream };
  getVoices(): Promise<{ ShortName: string; Locale: string; Gender: string }[]>;
  close(): void;
}

/**
 * The free speech route (architecture §8): `msedge-tts`, Microsoft's neural voices through an
 * undocumented endpoint with no SLA. The only file that imports it (conventions §11.5). The input
 * limit is a conservative guess for that endpoint.
 */
export class EdgeSpeechProvider extends SpeechProvider {
  readonly name = 'edge' as const;
  readonly format = 'mp3_24khz_48kbps_mono';
  readonly maxInputBytes = 4_000;

  constructor(private readonly client: () => EdgeClient = () => new MsEdgeTTS()) {
    super();
  }

  async listVoices(languageCode: string): Promise<VoiceSpec[]> {
    const client = this.client();
    try {
      const voices = await client.getVoices();
      return voices
        .filter((voice) => voice.Locale.toLowerCase() === languageCode.toLowerCase())
        .map((voice) => ({
          id: voice.ShortName,
          languageCode: voice.Locale,
          gender: voice.Gender,
        }));
    } finally {
      client.close();
    }
  }

  async synthesize(input: { ssml: string; voice: VoiceSpec }): Promise<Buffer> {
    const client = this.client();
    try {
      await client.setMetadata(input.voice.id, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = client.rawToStream(withVoice(input.ssml, input.voice));
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) chunks.push(Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    } finally {
      client.close();
    }
  }
}

/**
 * The document the Edge endpoint accepts: the voice inside it, and plain text only — it drops the
 * connection on `<break>`, `<prosody>` and the like. A `<sub>` becomes its alias, a `<phoneme>`
 * its written word, and a pause a sentence stop.
 */
export function withVoice(ssml: string, voice: VoiceSpec): string {
  const body = ssml
    .replace(/^<speak[^>]*>/, '')
    .replace(/<\/speak>\s*$/, '')
    .replace(/<sub alias="([^"]*)">[^<]*<\/sub>/g, '$1')
    .replace(/<phoneme[^>]*>([^<]*)<\/phoneme>/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(
      /([.!?…。！？])? ?<break[^>]*\/> ?/g,
      (_, stop: string | undefined) => `${stop ?? '.'} `,
    )
    .replace(/<[^<>]*>/g, '');
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.languageCode}">` +
    `<voice name="${voice.id}">${body}</voice></speak>`
  );
}
