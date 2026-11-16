import { describe, expect, it } from 'vitest';
import { formatSize, listeningTime } from './format';

describe('formatSize', () => {
  it('writes one decimal under 10, none above, and GB from a thousand MB', () => {
    expect(formatSize(48_200_000)).toBe('48 MB');
    expect(formatSize(400_000)).toBe('0.4 MB');
    expect(formatSize(9_960_000)).toBe('10 MB');
    expect(formatSize(1_200_000_000)).toBe('1.2 GB');
    expect(formatSize(12_000)).toBe('0.1 MB');
    expect(formatSize(0)).toBe('0 MB');
  });
});

describe('listeningTime', () => {
  it('splits whole minutes into hours and minutes', () => {
    expect(listeningTime(66 * 60_000)).toEqual({ hours: 1, minutes: 6 });
    expect(listeningTime(48 * 60_000 + 20_000)).toEqual({ hours: 0, minutes: 48 });
  });
});
