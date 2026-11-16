import { describe, expect, it } from 'vitest';
import { accountLocale, signedOutLocale } from './language';

describe('the console’s language (K12)', () => {
  it('is the switch’s cookie first', () => {
    expect(signedOutLocale('en', 'vi-VN,vi;q=0.9')).toBe('en');
    expect(signedOutLocale('vi', 'en-US')).toBe('vi');
  });

  it('else the browser’s first Vietnamese or English, by weight', () => {
    expect(signedOutLocale(null, 'vi-VN,vi;q=0.9,en;q=0.8')).toBe('vi');
    expect(signedOutLocale(null, 'en-GB,en;q=0.9')).toBe('en');
    expect(signedOutLocale(null, 'fr-FR,fr;q=0.9,en;q=0.5,vi;q=0.4')).toBe('en');
    expect(signedOutLocale(null, 'vi;q=0.3,en;q=0.7')).toBe('en');
    expect(signedOutLocale('xx', 'de, en;q=0')).toBe('vi');
  });

  it('else Vietnamese', () => {
    expect(signedOutLocale(null, 'fr-FR,de;q=0.8')).toBe('vi');
    expect(signedOutLocale(undefined, undefined)).toBe('vi');
  });

  it('signed in, the account’s', () => {
    expect(accountLocale('en')).toBe('en');
    expect(accountLocale('vi')).toBe('vi');
    // A long-tail language the console has no bundle for.
    expect(accountLocale('ko')).toBe('vi');
  });
});
