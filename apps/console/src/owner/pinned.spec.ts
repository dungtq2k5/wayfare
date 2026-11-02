import { describe, expect, it } from 'vitest';
import { pinnedLimits } from './pinned';

const growth = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: 'LAUNCH',
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: 'BASIC',
  canSellVouchers: true,
};

describe('the limits a pin set (Y1c)', () => {
  it('names each grant in force that differs from the plan’s, and only those', () => {
    expect(pinnedLimits({ ...growth, maxPlaces: 15, aiCreditsPerDay: 20 }, growth)).toEqual([
      { key: 'pin.maxPlaces', n: 15 },
      { key: 'pin.aiCreditsPerDay', n: 20 },
    ]);
    expect(
      pinnedLimits(
        {
          ...growth,
          autoNarration: false,
          narrationLanguageScope: 'EXTENDED',
          analyticsLevel: 'FULL',
          canSellVouchers: false,
        },
        growth,
      ),
    ).toEqual([
      { key: 'pin.autoNarrationOff' },
      { key: 'scope', scope: 'EXTENDED' },
      { key: 'analytics', level: 'FULL' },
      { key: 'pin.vouchersOff' },
    ]);
    expect(pinnedLimits(growth, growth)).toEqual([]);
  });
});
