import { describe, expect, it } from 'vitest';
import type { GeofencePlace, LocationFix } from './types';
import { wakeUpRegions } from './wake-up';

const fix: LocationFix = { t: 0, lat: 10.77, lng: 106.7, accuracyM: 5 };

/** A Place `degrees` of longitude east of the fix. */
const place = (id: string, degrees: number, autoNarrationEnabled = true): GeofencePlace =>
  ({
    id,
    kind: 'EDITORIAL',
    location: { lat: fix.lat, lng: fix.lng + degrees },
    triggerRadiusM: 40,
    narrationPriority: 0,
    autoNarrationEnabled,
  }) as GeofencePlace;

describe('wakeUpRegions', () => {
  it('returns the n nearest Places, nearest first, as id, location and radius only', () => {
    const regions = wakeUpRegions(
      fix,
      [place('far', 0.01), place('near', 0.001), place('mid', 0.005)],
      2,
    );
    expect(regions.map((region) => region.id)).toEqual(['near', 'mid']);
    expect(regions[0]).toEqual({
      id: 'near',
      location: { lat: fix.lat, lng: fix.lng + 0.001 },
      triggerRadiusM: 40,
    });
  });

  it('skips a Place that has auto-narration off, however near', () => {
    const regions = wakeUpRegions(fix, [place('off', 0.0001, false), place('on', 0.01)], 5);
    expect(regions.map((region) => region.id)).toEqual(['on']);
  });

  it('does not reorder the caller’s list', () => {
    const places = [place('b', 0.01), place('a', 0.001)];
    wakeUpRegions(fix, places, 2);
    expect(places.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
