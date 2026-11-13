import { describe, expect, expectTypeOf, it } from 'vitest';
import { compareStrings } from './sorting';
import { PLACE_STATUSES, TOUR_STATUSES } from '../catalog/enums';
import {
  LocalizationTargetType,
  OFFER_TRANSLATION_SOURCES,
  OVERRIDE_TARGET_TYPES,
  SYNTHESIS_PRIORITY,
  SYNTHESIS_TRIGGERS,
  TranslationSource,
} from '../narration/enums';
import type { OverrideTargetType } from '../narration/enums';

describe('enumerated subsets', () => {
  it('keeps HUMAN out of voucher offer localizations', () => {
    expect(OFFER_TRANSLATION_SOURCES).toEqual([
      TranslationSource.SOURCE,
      TranslationSource.MACHINE,
    ]);
  });

  it('gives override targets the same values as localization targets', () => {
    expectTypeOf<`${OverrideTargetType}`>().toExtend<`${LocalizationTargetType}`>();
    for (const value of OVERRIDE_TARGET_TYPES) {
      expect(Object.values(LocalizationTargetType)).toContain(value);
    }
  });

  it('keeps Place and Tour statuses equal today — a divergence is a deliberate edit', () => {
    expect(TOUR_STATUSES).toEqual(PLACE_STATUSES);
  });
});

describe('SYNTHESIS_PRIORITY', () => {
  it('has a priority for every trigger, on-demand first', () => {
    expect(Object.keys(SYNTHESIS_PRIORITY).toSorted(compareStrings)).toEqual(
      [...SYNTHESIS_TRIGGERS].toSorted(compareStrings),
    );
    expect(Math.min(...Object.values(SYNTHESIS_PRIORITY))).toBe(SYNTHESIS_PRIORITY.ON_DEMAND);
  });
});
