import type { Language } from '@wayfare/contracts';
import type { TranslationProviderName } from '../../config/env.schema';

/** Injection token for the configured translation providers, in order. */
export const TRANSLATION_PROVIDERS = Symbol('TRANSLATION_PROVIDERS');

/**
 * Machine translation, as narration uses it (ADR 0033). Implementations live beside this file;
 * nothing else imports a translation SDK (conventions §11.5).
 */
export abstract class TranslationProvider {
  /** Recorded on the task and the cache row that it answered. */
  abstract readonly name: TranslationProviderName;
  /** Whether its language-code map has an entry: an unmapped language is never guessed. */
  abstract supports(lang: Language): boolean;
  abstract translate(input: { text: string; from: 'vi'; to: Language }): Promise<string>;
}
