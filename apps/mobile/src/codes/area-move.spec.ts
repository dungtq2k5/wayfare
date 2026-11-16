import { describe, expect, it } from 'vitest';
import { areaMove } from './area-move';

describe('areaMove', () => {
  it('moves to the Place’s area when it is another one', () => {
    expect(areaMove('d1', 'vinh-khanh')).toEqual({ areaId: 'vinh-khanh' });
  });
  it('stays put in the same area, or for a Place with none', () => {
    expect(areaMove('d1', 'd1')).toBeNull();
    expect(areaMove('d1', null)).toBeNull();
  });
});
