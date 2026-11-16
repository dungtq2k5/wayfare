import type { PlaceSummaryResponseDto } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { minutesAgo, offlineList } from './kept-nearby';

const place = (name: string, distanceM: number, sponsored = false) =>
  ({ id: name, name, distanceM, sponsored }) as unknown as PlaceSummaryResponseDto;

describe('the kept nearby list offline (BT2)', () => {
  it('is by distance alone, nothing sponsored', () => {
    // The live answer had the boosted one moved ahead; offline it goes back to its distance.
    const live = [place('near', 120), place('boosted', 260, true), place('far', 180)];
    const shown = offlineList(live);
    expect(shown.map((row) => row.name)).toEqual(['near', 'far', 'boosted']);
    expect(shown.some((row) => row.sponsored)).toBe(false);
  });

  it('says its age in whole minutes', () => {
    expect(minutesAgo(0, 10 * 60_000 + 20_000)).toBe(10);
    expect(minutesAgo(5_000, 0)).toBe(0);
    expect(minutesAgo(0, 59_000)).toBe(0);
  });
});
