import { ContentTier } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { contentRows, resolveContentTier } from './content-tier';

const CURRENT = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const source = { name: 'Chợ Bến Thành', description: 'Chợ có từ năm 1914.', contentHash: CURRENT };
const row = (lang: string, hash = CURRENT) => ({
  lang,
  name: `name-${lang}`,
  description: `description-${lang}`,
  sourceContentHash: hash,
});

describe('resolveContentTier', () => {
  it('serves the requested row as REQUESTED', () => {
    const resolved = resolveContentTier({
      requested: 'ja',
      localizations: [row('en'), row('ja')],
      source,
    });
    expect(resolved).toMatchObject({ tier: ContentTier.REQUESTED, lang: 'ja', name: 'name-ja' });
    expect(resolved.stale).toBe(false);
    expect(resolved.localization?.lang).toBe('ja');
  });

  it('falls back to English', () => {
    expect(
      resolveContentTier({ requested: 'ko', localizations: [row('en')], source }),
    ).toMatchObject({ tier: ContentTier.ENGLISH, lang: 'en', name: 'name-en' });
  });

  it('falls back to English for an unserved tag', () => {
    expect(
      resolveContentTier({ requested: null, localizations: [row('en'), row('ja')], source }),
    ).toMatchObject({ tier: ContentTier.ENGLISH, lang: 'en' });
  });

  it('falls back to the source', () => {
    expect(resolveContentTier({ requested: 'ko', localizations: [], source })).toEqual({
      tier: ContentTier.SOURCE,
      name: source.name,
      description: source.description,
      lang: 'vi',
      stale: false,
      localization: null,
    });
  });

  it('flags a row made from an older source as stale', () => {
    expect(
      resolveContentTier({ requested: 'en', localizations: [row('en', OLD)], source }).stale,
    ).toBe(true);
    expect(
      resolveContentTier({ requested: 'ja', localizations: [row('en', OLD)], source }),
    ).toMatchObject({ tier: ContentTier.ENGLISH, stale: true });
  });

  it('serves vi from its own row as REQUESTED', () => {
    expect(
      resolveContentTier({ requested: 'vi', localizations: [row('vi'), row('en')], source }),
    ).toMatchObject({ tier: ContentTier.REQUESTED, lang: 'vi', name: 'name-vi' });
  });

  it('serves vi without a row from the source, never from English', () => {
    expect(
      resolveContentTier({ requested: 'vi', localizations: [row('en')], source }),
    ).toMatchObject({ tier: ContentTier.REQUESTED, lang: 'vi', name: source.name, stale: false });
  });
});

describe('contentRows', () => {
  it('names exactly the rows resolveContentTier can serve each language from', () => {
    const langs = ['en', 'vi', 'ja', 'fr'];
    // Every subset of rows, for every requested language: what is served is one of contentRows'.
    for (const requested of [null, 'en', 'vi', 'ja', 'fr']) {
      const { own, fallback } = contentRows(requested);
      for (let mask = 0; mask < 1 << langs.length; mask++) {
        const localizations = langs.filter((_, bit) => mask & (1 << bit)).map((lang) => row(lang));
        const served = resolveContentTier({ requested, localizations, source }).localization?.lang;
        if (served === undefined) continue;
        const ownStored = localizations.some((candidate) => candidate.lang === own);
        expect(served).toBe(ownStored ? own : fallback);
      }
    }
  });

  it('falls back to English only from a third language', () => {
    expect(contentRows('fr')).toEqual({ own: 'fr', fallback: 'en' });
    expect(contentRows('en')).toEqual({ own: 'en', fallback: null });
    expect(contentRows('vi')).toEqual({ own: 'vi', fallback: null });
    expect(contentRows(null)).toEqual({ own: 'en', fallback: null });
  });
});
