import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechProvider } from './speech-provider';
import type { VoiceSpec } from './speech-provider';

/** The part of the Google client the adapter uses, so a test can stand in for it. */
export interface GoogleSpeechClient {
  synthesizeSpeech(request: {
    input: { ssml: string };
    voice: { languageCode: string; name: string };
    audioConfig: { audioEncoding: 'MP3'; sampleRateHertz: number };
  }): Promise<readonly [{ audioContent?: Uint8Array | string | null }, ...unknown[]]>;
  listVoices(request: { languageCode: string }): Promise<
    readonly [
      {
        voices?:
          | readonly {
              name?: string | null;
              languageCodes?: string[] | null;
              ssmlGender?: unknown;
            }[]
          | null;
      },
      ...unknown[],
    ]
  >;
}

/**
 * Google Cloud Text-to-Speech — the only file that imports its SDK (conventions §11.5). Its MP3
 * bitrate is fixed at 32 kbps; its documented input limit is 5 000 bytes per request.
 */
export class GoogleSpeechProvider extends SpeechProvider {
  readonly name = 'google' as const;
  readonly format = 'mp3_24khz_32kbps_mono';
  readonly maxInputBytes = 5_000;
  private readonly client: GoogleSpeechClient;

  constructor(projectId: string, client?: GoogleSpeechClient) {
    super();
    // Credentials come from ADC: the key file locally, the service identity in Cloud Run.
    this.client = client ?? new TextToSpeechClient({ projectId });
  }

  async listVoices(languageCode: string): Promise<VoiceSpec[]> {
    const [response] = await this.client.listVoices({ languageCode });
    return (response.voices ?? []).flatMap((voice) =>
      voice.name
        ? [
            {
              id: voice.name,
              languageCode: voice.languageCodes?.[0] ?? languageCode,
              ...(voice.ssmlGender === undefined || voice.ssmlGender === null
                ? {}
                : { gender: String(voice.ssmlGender as string | number) }),
            },
          ]
        : [],
    );
  }

  async synthesize(input: { ssml: string; voice: VoiceSpec }): Promise<Buffer> {
    const [response] = await this.client.synthesizeSpeech({
      input: { ssml: input.ssml },
      voice: { languageCode: input.voice.languageCode, name: input.voice.id },
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24_000 },
    });
    const audio = response.audioContent;
    if (audio === undefined || audio === null) return Buffer.alloc(0);
    return typeof audio === 'string' ? Buffer.from(audio, 'base64') : Buffer.from(audio);
  }
}
