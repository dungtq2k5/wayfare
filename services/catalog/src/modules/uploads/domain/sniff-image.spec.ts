import { describe, expect, it } from 'vitest';
import { sniffImage } from './sniff-image';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('sniffImage', () => {
  it('recognises the three accepted types', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(
      sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56)),
    ).toBe('image/webp');
  });

  it('refuses anything else, including a truncated signature', () => {
    // HEIC: ....ftypheic
    expect(
      sniffImage(bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63)),
    ).toBeNull();
    // A RIFF that is not WebP (WAV).
    expect(
      sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImage(bytes())).toBeNull();
    expect(
      sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
  });
});
