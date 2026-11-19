import 'fake-indexeddb/auto';
import type { PlaceSummaryResponseDto } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { writeKv } from '../client/db';
import { keepNearby, keptNearby, minutesAgo, offlineList } from './kept-nearby';

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

describe('the nearby list kept for offline (BT2)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('keeps the last answer with when it loaded', async () => {
    expect(await keptNearby()).toBeNull();
    keepNearby([place('near', 120)], 1_000);
    await flush();
    expect(await keptNearby()).toEqual({ loadedAt: 1_000, places: [place('near', 120)] });
  });

  it('treats a kept value it can’t read as none', async () => {
    await writeKv('nearby.last', '{not json');
    expect(await keptNearby()).toBeNull();
  });
});
