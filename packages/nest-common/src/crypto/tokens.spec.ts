import { describe, expect, it } from 'vitest';
import { generateCode, generateToken, hashToken, keyedHash, timingSafeEqualHex } from './tokens';

describe('tokens', () => {
  it('generates 256-bit base64url secrets that never repeat', () => {
    const a = generateToken();
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes a token to 64 hex characters, deterministically', () => {
    expect(hashToken('secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('secret')).toBe(hashToken('secret'));
  });

  it('separates keyed hashes by purpose', () => {
    expect(keyedHash('k', 'email', 'x')).not.toBe(keyedHash('k', 'code', 'x'));
  });

  it('compares digests in constant time and refuses length mismatches', () => {
    const digest = hashToken('a');
    expect(timingSafeEqualHex(digest, hashToken('a'))).toBe(true);
    expect(timingSafeEqualHex(digest, hashToken('b'))).toBe(false);
    expect(timingSafeEqualHex(digest, 'ab')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
  });

  it('draws codes only from the alphabet', () => {
    expect(generateCode('AB', 50)).toMatch(/^[AB]{50}$/);
  });
});
