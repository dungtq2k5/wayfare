import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateEncodedSigningKeys, zPrivateKeyEnv, zPublicKeysEnv } from './keys';
import { signJws, verifyJws } from './jws';

const encoded = generateEncodedSigningKeys('k1');
const privateKey = zPrivateKeyEnv.parse(encoded.privateKey);
const publicKeys = zPublicKeysEnv.parse(encoded.publicKeys);
const now = new Date('2026-09-17T10:00:00.000Z');

const issue = (claims: Record<string, unknown> = { sub: 'x' }, at = now, ttlMs = 60_000) =>
  signJws(claims, { privateKey, keyId: 'k1', ttlMs, now: at }).token;

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('jws', () => {
  it('round-trips claims with iss, aud, iat and exp added', () => {
    const { token, expiresAt } = signJws(
      { sub: 'x' },
      { privateKey, keyId: 'k1', ttlMs: 90_000, now },
    );
    const result = verifyJws(token, { publicKeys, now });
    expect(result).toEqual({
      ok: true,
      claims: {
        sub: 'x',
        iss: 'wayfare-identity',
        aud: 'wayfare-gateway',
        iat: 1789639200,
        exp: 1789639290,
      },
    });
    expect(expiresAt.toISOString()).toBe('2026-09-17T10:01:30.000Z');
  });

  it('refuses a malformed token', () => {
    for (const token of ['', 'a.b', 'a.b.c.d', '!!.x.y', `${b64({ alg: 'EdDSA' })}.x.y`]) {
      expect(verifyJws(token, { publicKeys, now })).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses alg none', () => {
    const token = `${b64({ alg: 'none', kid: 'k1' })}.${b64({ sub: 'x' })}.`;
    expect(verifyJws(token, { publicKeys, now })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a token signed by a key the verifier does not list', () => {
    const other = generateEncodedSigningKeys('k2');
    const token = signJws(
      { sub: 'x' },
      { privateKey: zPrivateKeyEnv.parse(other.privateKey), keyId: 'k2', ttlMs: 60_000, now },
    ).token;
    expect(verifyJws(token, { publicKeys, now })).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('refuses a listed kid signed by another key', () => {
    const { privateKey: rogue } = generateKeyPairSync('ed25519');
    const token = signJws(
      { sub: 'x' },
      { privateKey: rogue, keyId: 'k1', ttlMs: 60_000, now },
    ).token;
    expect(verifyJws(token, { publicKeys, now })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a payload altered after signing', () => {
    const [header, , signature] = issue().split('.');
    const forged = `${header}.${b64({ sub: 'admin', iss: 'wayfare-identity', aud: 'wayfare-gateway', iat: 1, exp: 9e9 })}.${signature}`;
    expect(verifyJws(forged, { publicKeys, now })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses an expired token, allowing 30 s of skew', () => {
    const token = issue({ sub: 'x' }, now, 60_000);
    expect(verifyJws(token, { publicKeys, now: new Date(now.getTime() + 89_000) }).ok).toBe(true);
    expect(verifyJws(token, { publicKeys, now: new Date(now.getTime() + 90_000) })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a token issued in the future, or for another issuer or audience', () => {
    const future = issue({ sub: 'x' }, new Date(now.getTime() + 31_000));
    expect(verifyJws(future, { publicKeys, now })).toEqual({ ok: false, reason: 'claims' });
    const key = createPrivateKey(Buffer.from(encoded.privateKey, 'base64').toString());
    const header = b64({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' });
    const payload = b64({
      sub: 'x',
      iss: 'elsewhere',
      aud: 'wayfare-gateway',
      iat: 1789639200,
      exp: 1789639300,
    });
    const signature = sign(null, Buffer.from(`${header}.${payload}`), key).toString('base64url');
    expect(verifyJws(`${header}.${payload}.${signature}`, { publicKeys, now })).toEqual({
      ok: false,
      reason: 'claims',
    });
  });
});

describe('signing key env', () => {
  it('refuses a missing, non-PEM or non-Ed25519 private key', () => {
    expect(zPrivateKeyEnv.safeParse('').success).toBe(false);
    expect(zPrivateKeyEnv.safeParse('bm90IGEga2V5').success).toBe(false);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    expect(zPrivateKeyEnv.safeParse(Buffer.from(rsa.toString()).toString('base64')).success).toBe(
      false,
    );
  });

  it('refuses empty, non-JSON or malformed public key sets', () => {
    for (const value of ['', 'nope', '{}', '{"BAD KID":"x"}', '{"k1":"bm90"}']) {
      expect(zPublicKeysEnv.safeParse(value).success).toBe(false);
    }
    expect(zPublicKeysEnv.parse(encoded.publicKeys).has('k1')).toBe(true);
  });
});
