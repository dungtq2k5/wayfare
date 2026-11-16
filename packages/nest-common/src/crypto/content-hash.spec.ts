import { CanonicalJsonError } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { contentHash } from './content-hash';

describe('contentHash', () => {
  it('is SHA-256 hex of the canonical JSON', () => {
    // sha256('{"a":1}')
    expect(contentHash({ a: 1 })).toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    );
  });

  it('ignores key order, Unicode form and trailing whitespace', () => {
    const composed = { name: 'B\u1ebfn Th\u00e0nh', tags: ['a'] };
    const decomposed = { tags: ['a'], name: 'Be\u0302\u0301n Tha\u0300nh  ' };
    expect(contentHash(decomposed)).toBe(contentHash(composed));
  });

  it('changes with the content', () => {
    expect(contentHash({ name: 'A' })).not.toBe(contentHash({ name: 'B' }));
  });

  it('refuses a value JSON cannot say the same way twice', () => {
    expect(() => contentHash({ at: new Date(0) })).toThrow(CanonicalJsonError);
  });
});
