import { PlaceKind } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { isEligible, resolvePriority, type PriorityCandidate } from './priority';
import type { GeofenceConfig, GeofenceState } from './types';

const config: GeofenceConfig = {
  geofenceDebounceMs: 3_000,
  narrationCooldownMs: 5 * 60_000,
  commercialNarrationWindowMs: 10 * 60_000,
  commercialNarrationsPerWindow: 1,
  safetyReconcileIntervalMs: 5_000,
  locateMaxAccuracyM: 100,
  gpsGapMs: 15_000,
};

const state = (overrides: Partial<GeofenceState> = {}): GeofenceState => ({
  entries: {},
  lastFiredAt: {},
  venueDecisionsAt: [],
  lastFix: null,
  ...overrides,
});

const candidate = (
  id: string,
  kind: PlaceKind,
  overrides: Partial<{
    narrationPriority: number;
    autoNarrationEnabled: boolean;
    distanceM: number;
  }> = {},
): PriorityCandidate => ({
  place: {
    id,
    kind,
    location: { lat: 0, lng: 0 },
    triggerRadiusM: 30,
    narrationPriority: overrides.narrationPriority ?? 50,
    autoNarrationEnabled: overrides.autoNarrationEnabled ?? true,
  },
  distanceM: overrides.distanceM ?? 10,
});

describe('isEligible', () => {
  it('is false when autoNarrationEnabled is false', () => {
    expect(
      isEligible(
        candidate('a', PlaceKind.EDITORIAL, { autoNarrationEnabled: false }),
        state(),
        config,
        0,
      ),
    ).toBe(false);
  });

  it('is false inside the cooldown', () => {
    const c = candidate('a', PlaceKind.EDITORIAL);
    expect(
      isEligible(
        c,
        state({ lastFiredAt: { a: 1_000 } }),
        config,
        1_000 + config.narrationCooldownMs - 1,
      ),
    ).toBe(false);
  });

  it('is true once the cooldown has elapsed', () => {
    const c = candidate('a', PlaceKind.EDITORIAL);
    expect(
      isEligible(
        c,
        state({ lastFiredAt: { a: 1_000 } }),
        config,
        1_000 + config.narrationCooldownMs,
      ),
    ).toBe(true);
  });

  it('is false for a Venue when the commercial cap has no room', () => {
    const c = candidate('a', PlaceKind.VENUE);
    expect(
      isEligible(
        c,
        state({ venueDecisionsAt: [500] }),
        config,
        500 + config.commercialNarrationWindowMs - 1,
      ),
    ).toBe(false);
  });

  it('is true for a Venue once the window frees', () => {
    const c = candidate('a', PlaceKind.VENUE);
    expect(
      isEligible(
        c,
        state({ venueDecisionsAt: [500] }),
        config,
        500 + config.commercialNarrationWindowMs,
      ),
    ).toBe(true);
  });

  it('ignores the commercial cap for an Editorial Place', () => {
    const c = candidate('a', PlaceKind.EDITORIAL);
    expect(isEligible(c, state({ venueDecisionsAt: [0, 0, 0] }), config, 1)).toBe(true);
  });
});

describe('resolvePriority', () => {
  it('returns null when nothing is confirmed', () => {
    expect(resolvePriority([], state(), config, 0)).toBeNull();
  });

  it('returns null when every candidate is ineligible', () => {
    const c = candidate('a', PlaceKind.EDITORIAL, { autoNarrationEnabled: false });
    expect(resolvePriority([c], state(), config, 0)).toBeNull();
  });

  it('prefers Editorial over Venue regardless of narrationPriority', () => {
    const editorial = candidate('e', PlaceKind.EDITORIAL, { narrationPriority: 0 });
    const venue = candidate('v', PlaceKind.VENUE, { narrationPriority: 100 });
    expect(resolvePriority([venue, editorial], state(), config, 0)?.id).toBe('e');
    expect(resolvePriority([editorial, venue], state(), config, 0)?.id).toBe('e');
  });

  it('breaks a same-kind tie on the higher narrationPriority', () => {
    const low = candidate('low', PlaceKind.EDITORIAL, { narrationPriority: 10 });
    const high = candidate('high', PlaceKind.EDITORIAL, { narrationPriority: 90 });
    expect(resolvePriority([low, high], state(), config, 0)?.id).toBe('high');
  });

  it('breaks a priority tie on the nearer distance', () => {
    const far = candidate('far', PlaceKind.EDITORIAL, { distanceM: 40 });
    const near = candidate('near', PlaceKind.EDITORIAL, { distanceM: 5 });
    expect(resolvePriority([far, near], state(), config, 0)?.id).toBe('near');
  });

  it('breaks a distance tie on the lower placeId', () => {
    const b = candidate('b', PlaceKind.EDITORIAL);
    const a = candidate('a', PlaceKind.EDITORIAL);
    expect(resolvePriority([b, a], state(), config, 0)?.id).toBe('a');
  });

  it('skips a capped Venue and picks the next eligible candidate', () => {
    const cappedVenue = candidate('v', PlaceKind.VENUE);
    const editorial = candidate('e', PlaceKind.EDITORIAL);
    const eligible = resolvePriority(
      [cappedVenue, editorial],
      state({ venueDecisionsAt: [0] }),
      config,
      1,
    );
    expect(eligible?.id).toBe('e');
  });
});
