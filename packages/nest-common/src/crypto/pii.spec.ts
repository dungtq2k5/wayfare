import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptPii, encryptPii, PiiDecryptionError, piiLast4 } from './pii';

const key = randomBytes(32);
const nationalId = '079201001234';

describe('encryptPii / decryptPii', () => {
  it('round-trips, under a v1 prefix, without the plaintext in the stored value', () => {
    const stored = encryptPii(key, nationalId);
    expect(stored).toMatch(/^v1:[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(nationalId);
    expect(decryptPii(key, stored)).toBe(nationalId);
  });

  it('uses a fresh IV each call', () => {
    expect(encryptPii(key, nationalId)).not.toBe(encryptPii(key, nationalId));
  });

  it('refuses a tampered tag, a wrong key and an unknown prefix, never echoing the value', () => {
    const stored = encryptPii(key, nationalId);
    const raw = Buffer.from(stored.slice(3), 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    const tampered = `v1:${raw.toString('base64url')}`;
    const attempts = [
      () => decryptPii(key, tampered),
      () => decryptPii(randomBytes(32), stored),
      () => decryptPii(key, `v2:${stored.slice(3)}`),
      () => decryptPii(key, 'v1:AAAA'),
    ];
    for (const attempt of attempts) {
      let caught: unknown;
      try {
        attempt();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PiiDecryptionError);
      expect(String((caught as Error).message)).not.toContain(nationalId);
      expect(String((caught as Error).stack)).not.toContain(nationalId);
    }
  });

  it('refuses a key of the wrong size', () => {
    expect(() => encryptPii(randomBytes(16), nationalId)).toThrow(/32 bytes/);
  });
});

describe('piiLast4', () => {
  it('keeps the last four digits', () => {
    expect(piiLast4(nationalId)).toBe('1234');
  });
});
