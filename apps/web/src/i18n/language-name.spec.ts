import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageName } from './language-name';

describe('a language’s name in the page’s language', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names it in the page’s language', () => {
    expect(languageName('ja', 'en')).toBe('Japanese');
    expect(languageName('ja', 'vi')).toBe('Tiếng Nhật');
  });

  it('falls back to the English name, or the tag, when the engine can’t name it', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('no locale data');
    });
    expect(languageName('ja', 'xx')).toBe('Japanese');
    expect(languageName('zz', 'xx')).toBe('zz');
  });

  it('falls back when the engine only echoes the tag back', () => {
    expect(languageName('zz', 'en')).toBe('zz');
  });
});
