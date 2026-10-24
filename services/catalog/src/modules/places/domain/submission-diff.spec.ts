import { MenuCurrency } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { editableHash } from './editable-hash';
import { baseValuesOf, changedFields, submissionDiff } from './submission-diff';
import type { EditableSnapshot } from './submission-diff';

const base: EditableSnapshot = {
  nameVi: 'Quán',
  descriptionVi: 'Mô tả.',
  categoryCode: 'RESTAURANT',
  location: { lat: 10.77, lng: 106.69 },
  addressVi: null,
  priceBand: 2,
  phone: '+84901234567',
  websiteUrl: null,
  openingHours: [
    { weekday: 1, specificDate: null, opensAt: '08:00', closesAt: '21:00', isClosed: false },
  ],
  photos: [{ photoId: '01990000-0000-7000-8000-000000000001', altTextVi: null }],
  menu: { menuCurrency: MenuCurrency.VND, items: [] },
};

describe('submission diff', () => {
  it('names the fields that differ, in the fixed order', () => {
    const next = { ...base, phone: '+84999999999', descriptionVi: 'Mới.' };
    expect(changedFields(base, next)).toEqual(['descriptionVi', 'phone']);
    expect(submissionDiff(base, next)).toEqual([
      { field: 'descriptionVi', before: 'Mô tả.', after: 'Mới.' },
      { field: 'phone', before: '+84901234567', after: '+84999999999' },
    ]);
  });

  it("gives a conflict's values when the submission was sent", () => {
    // An admin edited the address and the hours after the owner sent their change.
    const live = { ...base, addressVi: '12 Lê Lợi', openingHours: [] };
    const conflict = changedFields(base, live);
    expect(baseValuesOf(base, conflict)).toEqual({
      addressVi: null,
      openingHours: base.openingHours,
    });
    expect(baseValuesOf(base, [])).toEqual({});
  });

  it('shows every field of a creation, from nothing', () => {
    expect(submissionDiff(null, base)).toHaveLength(11);
  });

  it('hashes the editable fields only, stable across key order', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as EditableSnapshot;
    expect(editableHash(reordered)).toBe(editableHash(base));
    expect(editableHash({ ...base, phone: null })).not.toBe(editableHash(base));
  });
});
