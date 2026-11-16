import type { Language } from '@wayfare/contracts';

/**
 * Splits a text into the sentences the device voice speaks one at a time (Android's engine has no
 * pause, so a pause is "stop, and say this sentence again"). A sentence ends at `.`, `!`, `?`, `…`
 * or the CJK `。！？`, and the closing quote or bracket that follows. Hermes has no
 * `Intl.Segmenter`, so it scans the text itself.
 */
export function splitSentences(text: string): string[] {
  const ENDERS = '.!?…。！？';
  const CLOSERS = '"\'”’)）」』';
  const sentences: string[] = [];
  let current = '';
  let ended = false;
  const push = () => {
    const sentence = current.trim();
    if (sentence.length > 0) sentences.push(sentence);
    current = '';
    ended = false;
  };
  for (const char of text) {
    const isEnd = ENDERS.includes(char);
    if (ended && !isEnd && !CLOSERS.includes(char)) push();
    current += char;
    if (isEnd) ended = true;
  }
  push();
  return sentences;
}

/** The engine's locale tag for each of our languages: it does not take `zh-Hans`. */
const ENGINE_LOCALE: Partial<Record<Language, string>> = {
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
};

export function engineLocale(lang: Language): string {
  return ENGINE_LOCALE[lang] ?? lang;
}

/** Whether any installed voice speaks `lang` (a voice's tag is `vi-VN`, `en_US`, …). */
export function hasVoiceFor(voiceLanguages: readonly string[], lang: Language): boolean {
  const wanted = engineLocale(lang).toLowerCase().replace('_', '-');
  const primary = wanted.split('-')[0];
  return voiceLanguages.some((tag) => {
    const have = tag.toLowerCase().replace('_', '-');
    return have === wanted || (wanted.split('-').length === 1 && have.split('-')[0] === primary);
  });
}
