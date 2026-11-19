import { describe, expect, it, vi } from 'vitest';
import { sharedPosition, sharePosition } from './shared-position';

describe('the position the tourist shared with Near me', () => {
  it('is none until shared, then the point and when', () => {
    expect(sharedPosition()).toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    sharePosition({ lat: 10.77, lng: 106.7 });
    expect(sharedPosition()).toEqual({ lat: 10.77, lng: 106.7, at: 1_000 });
  });
});
