import { createHash } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * An audio file's key (rdm-spec N-3): the final SSML — after the dictionary — with the language,
 * the voice and the provider's format. The same words in another voice or format are another file.
 */
export function audioCacheKey(input: {
  readonly ssml: string;
  readonly lang: string;
  readonly voiceId: string;
  readonly format: string;
}): string {
  return sha256([input.ssml.normalize('NFC'), input.lang, input.voiceId, input.format].join('\n'));
}

/**
 * A translation's key (rdm-spec N-4). The provider is deliberately not part of it: a translation
 * from one provider stays usable after falling back to another.
 */
export function translationCacheKey(input: {
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly text: string;
}): string {
  return sha256([input.sourceLang, input.targetLang, input.text.normalize('NFC')].join('\n'));
}
