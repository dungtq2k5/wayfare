import { typography } from '@wayfare/design-tokens/tokens';
import { describe, expect, it } from 'vitest';
import { scriptLeading } from './script-leading';

describe('scriptLeading', () => {
  it('raises every line height by a quarter for Thai and Hindi', () => {
    for (const language of ['th', 'hi']) {
      const leading = scriptLeading(language);
      expect(leading?.['--leading-body']).toBe(typography.body.lineHeight * 1.25);
      expect(leading?.['--leading-caption']).toBe(Math.round(typography.caption.lineHeight * 1.25));
    }
  });

  it('keeps the tokens’ heights for every other language', () => {
    for (const language of ['en', 'vi', 'ja', 'ru', null])
      expect(scriptLeading(language)).toBeNull();
  });
});
