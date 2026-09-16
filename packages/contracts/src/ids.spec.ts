import { describe, expect, it } from 'vitest';
import { isUuidV7, newId, zUuidV7 } from './ids';

describe('newId', () => {
  it('generates a UUIDv7', () => {
    expect(isUuidV7(newId())).toBe(true);
  });

  it('generates ids in creation order', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('zUuidV7', () => {
  it('accepts a UUIDv7', () => {
    expect(zUuidV7.safeParse(newId()).success).toBe(true);
  });

  // The whole rule (ADR 0055): a well-formed v4 is still refused.
  it('refuses a VALID v4 uuid', () => {
    expect(zUuidV7.safeParse('0d5f2c1e-8b2a-4f3e-9c1d-2a3b4c5d6e7f').success).toBe(false);
  });

  it('refuses a malformed id', () => {
    expect(zUuidV7.safeParse('not-a-uuid').success).toBe(false);
    expect(zUuidV7.safeParse('01a0aa38-2bcd-72f6-c123-59fc3ac9d03f').success).toBe(false); // bad variant
  });
});
