import { describe, expect, it } from 'vitest';
import { safeNext, signInHref } from './next';

describe('next (K3)', () => {
  it('keeps a same-site path', () => {
    expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/places?status=ACTIVE#top')).toBe('/places?status=ACTIVE#top');
  });

  it('drops anything else', () => {
    for (const value of [
      'https://evil.example/',
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      'account',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(value), String(value)).toBeNull();
    }
  });

  it('builds the sign-in link back to it', () => {
    expect(signInHref('/account', true)).toBe('/sign-in?next=%2Faccount&signedOut=1');
    expect(signInHref('https://evil.example')).toBe('/sign-in');
    expect(signInHref('/')).toBe('/sign-in');
  });
});
