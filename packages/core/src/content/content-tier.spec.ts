import { ContentTier } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { resolveContentTier } from './content-tier';

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
