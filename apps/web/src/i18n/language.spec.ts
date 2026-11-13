import { describe, expect, it } from 'vitest';
import { acceptedTags, pageLanguage, shortName } from './language';

describe('the first language (K7)', () => {
  it('takes a choice made on this browser before anything else', () => {
    expect(pageLanguage('ja', 'fr-FR,fr;q=0.9')).toEqual({
      lang: 'ja',
      chosen: true,
      unsupported: false,
    });
  });

  it("takes the first of the browser's languages Wayfare speaks, in its weight order", () => {
    expect(pageLanguage(undefined, 'sw;q=1, pt-BR;q=0.9, zh-TW;q=0.8, en;q=0.5').lang).toBe(
      'zh-Hant',
    );
    expect(pageLanguage(undefined, 'en;q=0.4, ko;q=0.9').lang).toBe('ko');
  });

  it("falls back to English, and says so, when none of them is Wayfare's", () => {
    expect(pageLanguage(undefined, 'sw, pt-BR;q=0.8')).toEqual({
      lang: 'en',
      chosen: false,
      unsupported: true,
    });
    expect(pageLanguage('xx', null).unsupported).toBe(true);
  });

  it('reads Accept-Language, dropping wildcards and zero weights', () => {
    expect(acceptedTags('fr;q=0, *;q=0.5, de-DE, en;q=0.7')).toEqual(['de-DE', 'en']);
    expect(acceptedTags('')).toEqual([]);
  });

  it('shortens a language for the header', () => {
    expect(shortName('en')).toBe('EN');
    expect(shortName('zh-Hans')).toBe('ZH HANS');
  });
});
