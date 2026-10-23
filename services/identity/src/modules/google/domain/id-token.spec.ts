import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkIdToken,
  FAKE_GOOGLE_KEY_ID,
  idTokenKeyId,
  isGoogleAuthoritative,
  signFakeIdToken,
} from './id-token';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = createPublicKey(privateKey);
const other = createPublicKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
const audience = 'server-client';
const now = new Date('2026-10-19T10:00:00Z');
const input = {
  sub: '1234567890',
  email: 'mai@gmail.com',
  emailVerified: true,
  name: 'Mai Nguyen',
  hd: null,
  nonce: 'n-1',
};
const token = (overrides: Partial<typeof input> = {}, at = now) =>
  signFakeIdToken(privateKey, { ...input, ...overrides }, { audience, now: at });

/** A token signed by the right key with one claim replaced. */
const withClaims = (claims: Record<string, unknown>) => {
  const [header, payload] = token().split('.') as [string, string];
  const body = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...claims };
  const forged = `${header}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
  return `${forged}.${token().split('.')[2]}`;
};

describe('a Google ID token', () => {
  it('passes with the right key, issuer, audience and expiry, and yields only what is kept', () => {
    expect(idTokenKeyId(token())).toBe(FAKE_GOOGLE_KEY_ID);
    expect(checkIdToken(token(), publicKey, { audience, now })).toEqual({
      ok: true,
      claims: {
        sub: '1234567890',
        email: 'mai@gmail.com',
        name: 'Mai Nguyen',
        hd: null,
        nonce: 'n-1',
      },
    });
  });

  it('fails on another key, an altered claim, another audience or a lapsed expiry', () => {
    const invalid = { ok: false, reason: 'INVALID' };
    expect(checkIdToken(token(), other, { audience, now })).toEqual(invalid);
    expect(checkIdToken(token(), undefined, { audience, now })).toEqual(invalid);
    expect(checkIdToken(withClaims({ sub: 'someone-else' }), publicKey, { audience, now })).toEqual(
      invalid,
    );
    expect(checkIdToken(token(), publicKey, { audience: 'another', now })).toEqual(invalid);
    const old = token({}, new Date(now.getTime() - 3_600_000 - 61_000));
    expect(checkIdToken(old, publicKey, { audience, now })).toEqual(invalid);
    // Within the minute's skew it still passes.
    const recent = token({}, new Date(now.getTime() - 3_600_000 - 30_000));
    expect(checkIdToken(recent, publicKey, { audience, now }).ok).toBe(true);
    expect(checkIdToken('not.a.token', publicKey, { audience, now })).toEqual(invalid);
  });

  it('says when the address is not verified', () => {
    expect(checkIdToken(token({ emailVerified: false }), publicKey, { audience, now })).toEqual({
      ok: false,
      reason: 'EMAIL_NOT_VERIFIED',
    });
  });
});

describe('Google owns the mailbox', () => {
  it('for Gmail and a Workspace domain, not for another address', () => {
    expect(isGoogleAuthoritative('mai@gmail.com', null)).toBe(true);
    expect(isGoogleAuthoritative('Mai@GoogleMail.com', null)).toBe(true);
    expect(isGoogleAuthoritative('mai@school.edu.vn', 'school.edu.vn')).toBe(true);
    expect(isGoogleAuthoritative('mai@yahoo.com', null)).toBe(false);
  });
});
