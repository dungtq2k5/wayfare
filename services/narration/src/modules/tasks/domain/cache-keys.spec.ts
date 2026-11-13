import { describe, expect, it } from 'vitest';
import { audioCacheKey, translationCacheKey } from './cache-keys';

const audio = {
  ssml: '<speak>Chợ</speak>',
  lang: 'en',
  voiceId: 'v',
  format: 'mp3_24khz_32kbps_mono',
};

describe('cache keys', () => {
  it('change with every part of the audio key, and not with Unicode form', () => {
    const key = audioCacheKey(audio);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    for (const change of [
      { lang: 'ja' },
      { voiceId: 'w' },
      { format: 'mp3_24khz_48kbps_mono' },
      { ssml: '<speak>Chợ.</speak>' },
    ]) {
      expect(audioCacheKey({ ...audio, ...change })).not.toBe(key);
    }
    expect(audioCacheKey({ ...audio, ssml: audio.ssml.normalize('NFD') })).toBe(key);
  });

  it('leave the provider out of the translation key', () => {
    const key = translationCacheKey({ sourceLang: 'vi', targetLang: 'en', text: 'Chợ' });
    expect(
      translationCacheKey({ sourceLang: 'vi', targetLang: 'en', text: 'Chợ'.normalize('NFD') }),
    ).toBe(key);
    expect(translationCacheKey({ sourceLang: 'vi', targetLang: 'ja', text: 'Chợ' })).not.toBe(key);
  });
});
