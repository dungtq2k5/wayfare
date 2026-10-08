import type { PlaceSyncRecord } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  byAreaThenName,
  byDistance,
  foldDiacritics,
  makeCollator,
  nameComparer,
} from './place-order';

const place = (id: string, name: string, areaId = 'area-1', lat = 10.77, lng = 106.7) =>
  ({ id, areaId, location: { lat, lng }, localization: { name } }) as unknown as PlaceSyncRecord;

describe('foldDiacritics', () => {
  it('drops Vietnamese marks and folds đ', () => {
    expect(foldDiacritics('Bảo tàng')).toBe('Bao tang');
    expect(foldDiacritics('Đức Bà · Dinh')).toBe('Duc Ba · Dinh');
  });
});

describe('names, for a reader of Vietnamese', () => {
  const names = ['Chợ', 'Dinh', 'Bưu điện', 'Bảo tàng'];
  const expected = ['Bảo tàng', 'Bưu điện', 'Chợ', 'Dinh'];

  it('are ordered by the collator when the runtime honours the locale', () => {
    // On this Node the full ICU collator answers; the fallback below is for Hermes.
    expect(makeCollator('vi')).not.toBeNull();
    expect([...names].sort(nameComparer('vi'))).toEqual(expected);
  });

  it('fall back to folded names when the collator ignores the locale', () => {
    const ignoring = () => null;
    expect([...names].sort(nameComparer('vi', ignoring))).toEqual(expected);
  });
});

describe('byDistance', () => {
  it('orders nearest first with a distance and a walking time', () => {
    const origin = { lat: 10.77, lng: 106.7 };
    const listed = byDistance(
      [place('far', 'Far', 'a', 10.78, 106.7), place('near', 'Near', 'a', 10.771, 106.7)],
      origin,
    );
    expect(listed.map((item) => item.record.id)).toEqual(['near', 'far']);
    expect(listed[0]).toMatchObject({ distanceM: 111, walkingMinutes: 2 });
  });
});

describe('byAreaThenName', () => {
  it('puts the area in view first, then orders by name, and hides distances', () => {
    const listed = byAreaThenName(
      [
        place('1', 'B', 'area-2'),
        place('2', 'A', 'area-2'),
        place('3', 'Z', 'area-1'),
        place('4', 'C', 'area-1'),
      ],
      'area-2',
      'en',
    );
    expect(listed.map((item) => item.record.id)).toEqual(['2', '1', '4', '3']);
    expect(listed.every((item) => item.distanceM === null)).toBe(true);
  });
});
