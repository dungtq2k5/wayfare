import { describe, expect, it } from 'vitest';
import { BUNDLED, createTranslator, ENGLISH, sharedNames } from './messages';

describe('the web’s messages (K1)', () => {
  it('ships English and Vietnamese, each with the Android app’s category and area names', () => {
    expect(Object.keys(BUNDLED).sort((a, b) => a.localeCompare(b))).toEqual(['en', 'vi']);
    expect(ENGLISH['category.CAFE']).toBeTypeOf('string');
    expect(BUNDLED.vi!['category.CAFE']).not.toBe(ENGLISH['category.CAFE']);
  });

  it('takes only the shared families from the app’s bundle', () => {
    expect(
      sharedNames({
        'category.CAFE': 'Café',
        'area.d1.subtitle': 'Downtown',
        'area.d1.extra.deep': 'no',
        'player.play': 'no',
      }),
    ).toEqual({ 'category.CAFE': 'Café', 'area.d1.subtitle': 'Downtown' });
  });
});

describe('a translator', () => {
  it('formats a key with its arguments, in the language', () => {
    const { t } = createTranslator('vi', BUNDLED.vi!);
    expect(t('player.play', { length: '2:15' })).toBe('Nghe câu chuyện · 2:15');
  });

  it('reads a key the language lacks in English, and an unknown key as itself', () => {
    const { t, tDynamic } = createTranslator('ja', { 'player.playInPlain': '{language}で再生' });
    expect(t('player.playInPlain', { language: '日本語' })).toBe('日本語で再生');
    expect(t('fav.undo')).toBe('Undo');
    expect(tDynamic('error.NO_SUCH_CODE')).toBe(ENGLISH['error.generic']);
    expect(tDynamic('error.NO_SUCH_CODE', undefined, 'fallback')).toBe('fallback');
  });

  it('uses the English text when a machine translation broke its ICU', () => {
    const { t } = createTranslator('ja', { 'player.playInPlain': '{language で再生' });
    expect(t('player.playInPlain', { language: 'Japanese' })).toBe('Play in Japanese');
  });

  it('answers the generic text, or the fallback, for a dynamic key missing its arguments', () => {
    const { tDynamic } = createTranslator('en', ENGLISH);
    expect(tDynamic('player.playInPlain')).toBe(ENGLISH['error.generic']);
    expect(tDynamic('player.playIn', undefined, 'try later')).toBe('try later');
    expect(tDynamic('error.RATE_LIMITED')).toBe(ENGLISH['error.RATE_LIMITED']);
  });
});
