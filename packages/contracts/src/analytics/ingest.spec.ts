import { describe, expect, it } from 'vitest';
import { geohashBounds, geohashCentre, geohashOf } from './geohash';
import {
  businessDaysBetween,
  clampOccurredAt,
  hasCoordinateField,
  heatmapKey,
  hourStart,
  parseCounterKey,
  runtimeKey,
  utcHoursOfBand,
  zAnalyticsEvent,
  zAnalyticsRange,
  zHourBand,
} from './ingest';

describe('the counters’ keys', () => {
  it('name a cell or an Area and its UTC hour, and read back', () => {
    const at = new Date('2026-11-07T10:42:13Z');
    expect(hourStart(at)).toEqual(new Date('2026-11-07T10:00:00Z'));
    expect(parseCounterKey(heatmapKey('w3gv2cp', at))).toEqual({
      hour: new Date('2026-11-07T10:00:00Z'),
      subject: 'w3gv2cp',
    });
    const area = '01a0b373-d3eb-73c0-bd64-001fdcfca699';
    expect(parseCounterKey(runtimeKey(area, at))?.subject).toBe(area);
    expect(parseCounterKey('rl:x:y')).toBeNull();
  });
});

describe('an event', () => {
  const base = {
    id: '7c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c',
    sessionId: '8c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c',
    occurredAt: '2026-11-07T10:00:00.000Z',
  };

  it('a narration states its Place, trigger and tier; listening comes with its end', () => {
    const placeId = '9c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c';
    expect(
      zAnalyticsEvent.safeParse({
        ...base,
        type: 'NARRATION_STARTED',
        placeId,
        trigger: 'TAP',
        audioTier: 'T2',
      }).success,
    ).toBe(true);
    expect(zAnalyticsEvent.safeParse({ ...base, type: 'NARRATION_STARTED', placeId }).success).toBe(
      false,
    );
    expect(
      zAnalyticsEvent.safeParse({ ...base, type: 'NARRATION_COMPLETED', placeId }).success,
    ).toBe(false);
    expect(zAnalyticsEvent.safeParse({ ...base, type: 'APP_OPENED', listenMs: 3 }).success).toBe(
      false,
    );
  });

  it('carries no search words and no unknown props; a cell is a geohash-7', () => {
    expect(
      zAnalyticsEvent.safeParse({ ...base, type: 'SEARCH_PERFORMED', props: { query: 'ốc' } })
        .success,
    ).toBe(false);
    expect(
      zAnalyticsEvent.safeParse({ ...base, type: 'SEARCH_PERFORMED', props: { resultCount: 2 } })
        .success,
    ).toBe(true);
    expect(zAnalyticsEvent.safeParse({ ...base, type: 'APP_OPENED', cell: 'w3gv2c' }).success).toBe(
      false,
    );
  });

  it('a coordinate is found at any depth', () => {
    expect(hasCoordinateField([{ props: { a: [{ Latitude: 1 }] } }])).toBe(true);
    expect(hasCoordinateField([{ cell: 'w3gv2cp', props: { resultCount: 1 } }])).toBe(false);
  });

  it('the clock is believed a week back and five minutes ahead', () => {
    const received = new Date('2026-11-07T10:00:00Z');
    expect(clampOccurredAt(new Date('2020-01-01T00:00:00Z'), received)).toEqual(
      new Date('2026-10-31T10:00:00Z'),
    );
    expect(clampOccurredAt(new Date('2031-01-01T00:00:00Z'), received)).toEqual(
      new Date('2026-11-07T10:05:00Z'),
    );
  });
});

describe('ranges and bands', () => {
  it('a range is at most 93 business days, from not after to', () => {
    expect(businessDaysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(zAnalyticsRange.safeParse({ from: '2026-08-02', to: '2026-11-02' }).success).toBe(true);
    expect(zAnalyticsRange.safeParse({ from: '2026-08-01', to: '2026-11-02' }).success).toBe(false);
    expect(zAnalyticsRange.safeParse({ from: '2026-11-03', to: '2026-11-02' }).success).toBe(false);
  });

  it('a Vietnam-time band becomes UTC hours, crossing midnight', () => {
    expect(utcHoursOfBand(zHourBand.parse('18-24'))).toEqual([11, 12, 13, 14, 15, 16]);
    expect(utcHoursOfBand(zHourBand.parse('0-3'))).toEqual([17, 18, 19]);
    expect(zHourBand.safeParse('20-18').success).toBe(false);
    expect(zHourBand.safeParse('0-25').success).toBe(false);
  });
});

describe('geohash', () => {
  it('a point’s cell holds the point, and its centre is inside its square', () => {
    const cell = geohashOf(10.7605, 106.7035);
    expect(cell).toHaveLength(7);
    const box = geohashBounds(cell);
    expect(10.7605).toBeGreaterThanOrEqual(box.minLat);
    expect(10.7605).toBeLessThanOrEqual(box.maxLat);
    expect(geohashOf(geohashCentre(cell).lat, geohashCentre(cell).lng)).toBe(cell);
  });
});
