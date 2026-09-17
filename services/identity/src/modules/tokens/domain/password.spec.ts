import { describe, expect, it } from 'vitest';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password';

describe('password helpers', () => {
  it('hashes with argon2id and verifies', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPassword(hashed, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong')).toBe(false);
  });

  it('computes one dummy hash that no password matches', async () => {
    const dummy = await dummyPasswordHash();
    expect(await dummyPasswordHash()).toBe(dummy);
    expect(dummy).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(dummy, '')).toBe(false);
    expect(await verifyPassword(dummy, 'password123')).toBe(false);
  });

  it('treats a malformed hash as a mismatch', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
