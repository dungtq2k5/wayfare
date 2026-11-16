import { describe, expect, it } from 'vitest';
import { isXiaomi } from './maker';

describe('isXiaomi', () => {
  it.each(['Xiaomi', 'xiaomi ', 'Redmi', 'POCO'])('puts HyperOS first for %s', (maker) => {
    expect(isXiaomi(maker)).toBe(true);
  });
  it.each(['samsung', 'Google', '', null, undefined])('does not for %s', (maker) => {
    expect(isXiaomi(maker)).toBe(false);
  });
});
