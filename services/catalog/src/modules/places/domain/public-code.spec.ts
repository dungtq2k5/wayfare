import { PUBLIC_CODE_PATTERN } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { PUBLIC_CODE_ENTROPY_BYTES, publicCodeFrom } from './public-code';

describe('publicCodeFrom', () => {
  it('spends five bits per character', () => {
    expect(PUBLIC_CODE_ENTROPY_BYTES).toBe(5);
    expect(publicCodeFrom(new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000');
    expect(publicCodeFrom(new Uint8Array([255, 255, 255, 255, 255]))).toBe('ZZZZZZZZ');
    // 00001 00010 00011 00100 00101 00110 00111 01000
    expect(publicCodeFrom(new Uint8Array([0x08, 0x86, 0x42, 0x98, 0xe8]))).toBe('12345678');
  });

  it('always matches the public code format', () => {
    for (let seed = 0; seed < 256; seed++) {
      const bytes = new Uint8Array([seed, seed * 7, seed * 13, seed * 31, seed * 57]);
      expect(publicCodeFrom(bytes)).toMatch(PUBLIC_CODE_PATTERN);
    }
  });

  it('refuses too few bytes', () => {
    expect(() => publicCodeFrom(new Uint8Array(4))).toThrow(RangeError);
  });
});
