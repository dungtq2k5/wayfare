import { describe, expect, it } from 'vitest';
import { normalizeLang, zLanguage, zRequestedLanguage } from './languages';
import { canonicalJson, CanonicalJsonError, normalizeText } from './text';
import { businessDay } from './time';

describe('normalizeLang', () => {
  it.each([
    ['en', 'en'],
    ['EN-us', 'en'],
    ['ja-JP', 'ja'],
    ['vi', 'vi'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-Hans-TW', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['ZH-hk', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['fr-CA', 'fr'],
  ])('%s → %s', (tag, expected) => {
    expect(normalizeLang(tag)).toBe(expected);
  });

  it.each(['pt', 'pt-BR', 'xx', 'en_US', '', 'a-very-long-tag-x'])('%s is not served', (tag) => {
    expect(normalizeLang(tag)).toBeNull();
  });
});

describe('language schemas', () => {
  it('lets a tourist ask for an UNSUPPORTED language without an error', () => {
    expect(zRequestedLanguage.parse('pt')).toEqual({ tag: 'pt', lang: null });
    expect(zRequestedLanguage.parse('ZH-tw')).toEqual({ tag: 'ZH-tw', lang: 'zh-Hant' });
  });

  it('still refuses a malformed tag on a request', () => {
    expect(zRequestedLanguage.safeParse('en_US').success).toBe(false);
    expect(zRequestedLanguage.safeParse('abcdefgh-ijklmnop').success).toBe(false); // 17 characters
    expect(zRequestedLanguage.safeParse('x;drop').success).toBe(false);
  });

  it('is strict for writes and events', () => {
    expect(zLanguage.safeParse('pt').success).toBe(false);
    expect(zLanguage.parse('EN-gb')).toBe('en');
  });
});

describe('normalizeText', () => {
  it('makes NFD and NFC spellings equal', () => {
    const decomposed = 'Be\u0302\u0301n Tha\u0300nh';
    const composed = 'B\u1ebfn Th\u00e0nh';
    expect(decomposed).not.toBe(composed);
    expect(normalizeText(decomposed)).toBe(normalizeText(composed));
  });

  it('turns CRLF and CR into LF', () => {
    expect(normalizeText('a\r\nb')).toBe('a\nb');
    expect(normalizeText('a\rb')).toBe('a\nb');
  });

  it('collapses inner whitespace, keeps paragraphs, trims', () => {
    expect(normalizeText('  one \t two  \n\n\n\nthree   \n')).toBe('one two\n\nthree');
  });
});

describe('canonicalJson', () => {
  it('ignores key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
  });

  it('treats an undefined property as absent', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });

  it('normalizes strings, so whitespace-only edits do not change the output', () => {
    expect(canonicalJson({ name: 'Ch\u1ee3  B\u1ebfn Th\u00e0nh ' })).toBe(
      canonicalJson({ name: 'Ch\u1ee3 B\u1ebfn Th\u00e0nh' }),
    );
  });

  it.each([
    ['a Date', { at: new Date(0) }],
    ['a Map', { m: new Map() }],
    ['undefined in an array', [1, undefined]],
    ['a non-finite number', { n: Number.POSITIVE_INFINITY }],
    ['a function', { f: () => 1 }],
  ])('refuses %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });
});

describe('businessDay', () => {
  it('rolls over at midnight in Ho Chi Minh City (UTC+7, no DST)', () => {
    expect(businessDay(new Date('2026-09-16T16:59:59.999Z'))).toBe('2026-09-16');
    expect(businessDay(new Date('2026-09-16T17:00:00.000Z'))).toBe('2026-09-17');
    expect(businessDay(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });

  it('refuses an invalid Date', () => {
    expect(() => businessDay(new Date('nope'))).toThrow(RangeError);
  });
});
