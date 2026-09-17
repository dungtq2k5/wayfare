import { describe, expect, it } from 'vitest';
import { PublicCache } from './public-cache.decorator';

describe('PublicCache', () => {
  it('refuses a lifetime that is not a positive whole number of seconds', () => {
    for (const seconds of [0, -1, 1.5, Number.NaN]) {
      expect(() => PublicCache(seconds)).toThrow(RangeError);
    }
    expect(() => PublicCache(300)).not.toThrow();
  });
});
