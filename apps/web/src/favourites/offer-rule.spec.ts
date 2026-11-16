import { describe, expect, it } from 'vitest';
import { offerAfterSave } from './offer-rule';

describe('the account offer (K9)', () => {
  it('comes after the first save and the third, then never', () => {
    expect([1, 2, 3, 4, 5, 9].map((saves) => offerAfterSave(saves, false))).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('never comes to someone signed in', () => {
    expect(offerAfterSave(1, true)).toBe(false);
  });
});
