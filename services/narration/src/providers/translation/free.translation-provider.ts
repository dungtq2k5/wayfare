import translate from 'google-translate-api-x';
import type { Language } from '@wayfare/contracts';
import { googleTranslateCode } from './language-codes';
import { TranslationProvider } from './translation-provider';

/** The free call, so a test can stand in for it. */
export type FreeTranslate = (
  text: string,
  options: { from: string; to: string; forceBatch: boolean },
) => Promise<{ text: string }>;

/**
 * The free route (architecture §8): `google-translate-api-x`, an undocumented endpoint with no SLA.
 * The only file that imports it (conventions §11.5).
 */
export class FreeTranslationProvider extends TranslationProvider {
  readonly name = 'free' as const;

  constructor(private readonly call: FreeTranslate = translate) {
    super();
  }

  supports(lang: Language): boolean {
    return googleTranslateCode(lang) !== null;
  }

  async translate(input: { text: string; from: 'vi'; to: Language }): Promise<string> {
    const result = await this.call(input.text, {
      from: googleTranslateCode(input.from)!,
      to: googleTranslateCode(input.to)!,
      forceBatch: true,
    });
    return result.text;
  }
}
