import { v3 } from '@google-cloud/translate';
import type { Language } from '@wayfare/contracts';
import { googleTranslateCode } from './language-codes';
import { TranslationProvider } from './translation-provider';

/** The part of the Google client the adapter uses, so a test can stand in for it. */
export interface GoogleTranslateClient {
  translateText(request: {
    parent: string;
    contents: string[];
    mimeType: string;
    sourceLanguageCode: string;
    targetLanguageCode: string;
  }): Promise<
    readonly [{ translations?: readonly { translatedText?: string | null }[] | null }, ...unknown[]]
  >;
}

/** Google Cloud Translation v3 — the only file that imports its SDK (conventions §11.5). */
export class GoogleTranslationProvider extends TranslationProvider {
  readonly name = 'google' as const;
  private readonly client: GoogleTranslateClient;

  constructor(
    private readonly projectId: string,
    client?: GoogleTranslateClient,
  ) {
    super();
    // Credentials come from ADC: the key file locally, the service identity in Cloud Run.
    this.client = client ?? new v3.TranslationServiceClient({ projectId });
  }

  supports(lang: Language): boolean {
    return googleTranslateCode(lang) !== null;
  }

  async translate(input: { text: string; from: 'vi'; to: Language }): Promise<string> {
    const [response] = await this.client.translateText({
      parent: `projects/${this.projectId}/locations/global`,
      contents: [input.text],
      mimeType: 'text/plain',
      sourceLanguageCode: googleTranslateCode(input.from)!,
      targetLanguageCode: googleTranslateCode(input.to)!,
    });
    return response.translations?.[0]?.translatedText ?? '';
  }
}
