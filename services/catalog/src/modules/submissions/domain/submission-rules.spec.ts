import { FREE_PLAN_GRANTS, MenuCurrency } from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { hasPlaceRoom, payloadLimitBreach } from './submission-rules';

const payload = (photos: number, items: number) =>
  ({
    photos: Array.from({ length: photos }, () => ({ uploadId: 'u', altTextVi: null })),
    menu: {
      menuCurrency: MenuCurrency.VND,
      items: Array.from({ length: items }, () => ({ nameVi: 'x' })),
    },
  }) as unknown as PlaceSubmissionPayload;

describe('submission rules', () => {
  it('names the first limit a payload goes past', () => {
    expect(payloadLimitBreach(payload(3, 10), FREE_PLAN_GRANTS)).toBeNull();
    expect(payloadLimitBreach(payload(4, 0), FREE_PLAN_GRANTS)).toEqual({
      code: 'PHOTO_LIMIT_REACHED',
      limit: 3,
    });
    expect(payloadLimitBreach(payload(0, 11), FREE_PLAN_GRANTS)).toEqual({
      code: 'MENU_LIMIT_REACHED',
      limit: 10,
    });
  });

  it('counts pending creations against the place limit', () => {
    expect(hasPlaceRoom({ used: 0, reserved: 0 }, 1)).toBe(true);
    expect(hasPlaceRoom({ used: 0, reserved: 1 }, 1)).toBe(false);
    expect(hasPlaceRoom({ used: 1, reserved: 0 }, 1)).toBe(false);
  });
});
