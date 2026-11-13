import { describe, expect, it } from 'vitest';
import type { PronunciationRule } from './ssml';
import {
  applyDictionary,
  escapeXml,
  placeSsmlBody,
  rulesFor,
  sentencesOf,
  splitSsml,
  wholeSsml,
} from './ssml';

const sub = (
  term: string,
  replacement: string,
  targetLang: string | null = null,
): PronunciationRule => ({
  term,
  targetLang,
  replacementType: 'SUB',
  replacement,
  alphabet: null,
});

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

describe('escapeXml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeXml(`A & B <c> "d" 'e'`)).toBe('A &#38; B &#60;c&#62; &#34;d&#34; &#39;e&#39;');
  });
});

describe('the dictionary', () => {
  it('applies the longest term first, whole words only, in one pass', () => {
    const rules = [sub('Bến Thành', 'Ben Tahn'), sub('Bến', 'Ben')];
    expect(applyDictionary('Chợ Bến Thành và Bến Nghé, không phải XBến', rules)).toBe(
      'Chợ <sub alias="Ben Tahn">Bến Thành</sub> và <sub alias="Ben">Bến</sub> Nghé, không phải XBến',
    );
  });

  it('writes a phoneme with its alphabet', () => {
    const rule: PronunciationRule = {
      term: 'Phở',
      targetLang: 'en',
      replacementType: 'PHONEME',
      replacement: 'fɜː',
      alphabet: 'ipa',
    };
    expect(applyDictionary('Phở bò', [rule])).toBe(
      '<phoneme alphabet="ipa" ph="fɜː">Phở</phoneme> bò',
    );
  });

  it('lets a language-specific entry win, and gives vi none', () => {
    const rules = [sub('Chợ', 'Chuh'), sub('Chợ', 'Cho', 'ja'), sub('Chợ', 'Chaw', 'ko')];
    expect(rulesFor(rules, 'ja').map((rule) => rule.replacement)).toEqual(['Cho']);
    expect(rulesFor(rules, 'en').map((rule) => rule.replacement)).toEqual(['Chuh']);
    expect(rulesFor(rules, 'vi')).toEqual([]);
  });

  it('builds a Place body: name, pause, description, escaped then pronounced', () => {
    expect(
      placeSsmlBody({
        name: 'Chợ & Co',
        description: 'Bến Thành.',
        lang: 'en',
        rules: [sub('Bến Thành', 'Ben Tahn')],
      }),
    ).toBe('Chợ &#38; Co<break time="600ms"/><sub alias="Ben Tahn">Bến Thành</sub>.');
  });
});

describe('splitting', () => {
  it('cuts at sentence ends, never inside a tag or an element', () => {
    expect(sentencesOf('Một. Hai! <sub alias="A. B">X. Y</sub> ba? Bốn')).toEqual([
      'Một. ',
      'Hai! ',
      '<sub alias="A. B">X. Y</sub> ba? ',
      'Bốn',
    ]);
    expect(sentencesOf('一。二！三')).toEqual(['一。', '二！', '三']);
    expect(sentencesOf('v1.2 is out.\nNext')).toEqual(['v1.2 is out.\n', 'Next']);
  });

  it('packs whole sentences under the byte limit, the name and pause in the first', () => {
    const body = `Chợ<break time="600ms"/>${'Câu văn tiếng Việt khá dài. '.repeat(40)}`;
    const split = splitSsml(body, 300);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.chunks.length).toBeGreaterThan(3);
    for (const chunk of split.chunks) {
      expect(bytes(chunk)).toBeLessThanOrEqual(300);
      expect(chunk.startsWith('<speak>') && chunk.endsWith('</speak>')).toBe(true);
    }
    expect(split.chunks[0]).toMatch(/^<speak>Chợ<break time="600ms"\/>/);
    expect(split.chunks.map((chunk) => chunk.slice(7, -8)).join('')).toBe(body);
  });

  it('splits a 4 000-character Japanese description under 5 000 bytes a chunk', () => {
    const description = 'この市場は長い歴史を持っています。'.repeat(236).slice(0, 4000);
    const body = placeSsmlBody({ name: 'ベンタイン市場', description, lang: 'ja', rules: [] });
    expect(bytes(wholeSsml(body))).toBeGreaterThan(12_000);
    const split = splitSsml(body, 5_000);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of split.chunks) expect(bytes(chunk)).toBeLessThanOrEqual(5_000);
  });

  it('refuses a single sentence over the limit', () => {
    expect(splitSsml('x'.repeat(400), 300)).toEqual({ ok: false, reason: 'SENTENCE_TOO_LONG' });
  });
});
