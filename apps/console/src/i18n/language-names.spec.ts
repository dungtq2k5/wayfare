import { afterEach, describe, expect, it, vi } from 'vitest';
import { autonym, languageName, languageOption } from './language-names';

describe('a language’s names', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives a served language its own name, any other the runtime’s, capitalized', () => {
    expect(autonym('vi')).toBe('Tiếng Việt');
    expect(autonym('th')).toBe('ไทย');
  });

  it('names it in the console’s language: the contract’s English name, else the runtime’s', () => {
    expect(languageName('ja', 'en')).toBe('Japanese');
    expect(languageName('th', 'en')).toBe('Thai');
    expect(languageName('ja', 'vi')).toBe('Tiếng Nhật');
  });

  it('answers the code when the runtime can’t name it', () => {
    expect(languageName('not a tag', 'en')).toBe('not a tag');
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('no locale data');
    });
    expect(languageName('th', 'xx')).toBe('th');
  });

  it('offers a language by its own name, the console’s in brackets when they differ', () => {
    expect(languageOption('th', 'en')).toBe('ไทย (Thai)');
    expect(languageOption('not a tag', 'en')).toBe('not a tag');
  });
});
