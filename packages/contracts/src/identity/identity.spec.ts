import { describe, expect, it } from 'vitest';
import { newId } from '../common/ids';
import { zAccountClaims, zDeviceClaims } from './auth-claims';
import { accountLink } from './account-links';
import { maskEmail, normalizeEmail, zEmail } from './email';
import { LEGAL_DOCUMENTS } from './enums';
import { isCurrentLegalVersion, LEGAL_DOCUMENT_VERSIONS } from './legal';

describe('email', () => {
  it('normalizes by trimming and lower-casing only', () => {
    expect(normalizeEmail('  Ann.Lee+Trip@Example.COM ')).toBe('ann.lee+trip@example.com');
  });

  it('validates after normalizing, within 254 characters', () => {
    expect(zEmail.parse(' A@B.co ')).toBe('a@b.co');
    expect(zEmail.safeParse('not-an-email').success).toBe(false);
    expect(zEmail.safeParse(`${'a'.repeat(250)}@b.co`).success).toBe(false);
  });
});

describe('legal versions', () => {
  it('name a current version for every document', () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(LEGAL_DOCUMENT_VERSIONS[document]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isCurrentLegalVersion(document, LEGAL_DOCUMENT_VERSIONS[document])).toBe(true);
      expect(isCurrentLegalVersion(document, '2020-01-01')).toBe(false);
    }
  });
});

describe('token claims', () => {
  const now = 1_789_000_000;
  const registered = {
    iss: 'wayfare-identity',
    aud: 'wayfare-gateway',
    sub: newId(),
    iat: now,
    exp: now + 900,
  };
  const account = {
    ...registered,
    typ: 'user',
    iatMs: now * 1000,
    sid: newId(),
    perms: ['place.read'],
    ov: false,
    ev: true,
  };

  it('parse a device token and an account token', () => {
    expect(zDeviceClaims.safeParse({ ...registered, typ: 'device' }).success).toBe(true);
    expect(zAccountClaims.safeParse(account).success).toBe(true);
    expect(zAccountClaims.safeParse({ ...account, did: newId() }).success).toBe(true);
  });

  it('keep a permission code this build does not know — a newer identity may issue it', () => {
    expect(zAccountClaims.parse({ ...account, perms: ['future.thing'] }).perms).toEqual([
      'future.thing',
    ]);
    expect(zAccountClaims.safeParse({ ...account, perms: ['Not A Code'] }).success).toBe(false);
  });

  it('refuse a mixed-up token type, a foreign audience and an unknown claim', () => {
    expect(zDeviceClaims.safeParse({ ...registered, typ: 'user' }).success).toBe(false);
    expect(zAccountClaims.safeParse({ ...account, aud: 'elsewhere' }).success).toBe(false);
    expect(zAccountClaims.safeParse({ ...account, admin: true }).success).toBe(false);
  });
});

describe('maskEmail', () => {
  it.each([
    ['anne@example.com', 'a***e@example.com'],
    ['a@example.com', '*@example.com'],
    ['ab@example.com', 'a*@example.com'],
  ])('%s → %s', (address, masked) => {
    expect(maskEmail(address)).toBe(masked);
  });
});

describe('accountLink', () => {
  it('puts the token in the fragment, encoded, and joins the base once', () => {
    expect(accountLink('https://console.example.com/', 'resetPassword', 'a+b/c')).toBe(
      'https://console.example.com/reset-password#token=a%2Bb%2Fc',
    );
    expect(accountLink('https://app.example.com/web', 'verifyEmail', 'tok')).toBe(
      'https://app.example.com/web/verify-email#token=tok',
    );
    expect(accountLink('https://app.example.com', 'verifyEmail')).toBe(
      'https://app.example.com/verify-email',
    );
  });
});
