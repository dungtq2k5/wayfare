import type { Language } from '@wayfare/contracts';
import type { VoiceSpec } from '../providers/speech/speech-provider';
import type { SpeechProviderName } from './env.schema';

/**
 * One pinned voice per language and speech provider (architecture §8), reviewed like code. A
 * language with no voice under any configured provider is text-only: its text is published and
 * its audio reported `NO_VOICE`. No long-tail language has one yet.
 */
export const NARRATION_VOICES: Readonly<
  Record<SpeechProviderName, Partial<Record<Language, VoiceSpec>>>
> = {
  fake: {
    vi: { id: 'fake-vi', languageCode: 'vi' },
    en: { id: 'fake-en', languageCode: 'en' },
    'zh-Hans': { id: 'fake-zh-Hans', languageCode: 'zh-Hans' },
    ja: { id: 'fake-ja', languageCode: 'ja' },
    ko: { id: 'fake-ko', languageCode: 'ko' },
  },
  google: {
    vi: { id: 'vi-VN-Neural2-A', languageCode: 'vi-VN' },
    en: { id: 'en-US-Neural2-F', languageCode: 'en-US' },
    // Mandarin voices speak `cmn-CN`.
    'zh-Hans': { id: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN' },
    ja: { id: 'ja-JP-Neural2-B', languageCode: 'ja-JP' },
    ko: { id: 'ko-KR-Neural2-A', languageCode: 'ko-KR' },
  },
  edge: {
    vi: { id: 'vi-VN-HoaiMyNeural', languageCode: 'vi-VN' },
    en: { id: 'en-US-JennyNeural', languageCode: 'en-US' },
    'zh-Hans': { id: 'zh-CN-XiaoxiaoNeural', languageCode: 'zh-CN' },
    ja: { id: 'ja-JP-NanamiNeural', languageCode: 'ja-JP' },
    ko: { id: 'ko-KR-SunHiNeural', languageCode: 'ko-KR' },
  },
};

/** The pinned voice of `provider` for `lang`, or null. */
export function voiceFor(provider: SpeechProviderName, lang: string): VoiceSpec | null {
  const voices: Partial<Record<string, VoiceSpec>> = NARRATION_VOICES[provider];
  // Own keys only: `constructor` is not a language.
  return Object.hasOwn(voices, lang) ? (voices[lang] ?? null) : null;
}
