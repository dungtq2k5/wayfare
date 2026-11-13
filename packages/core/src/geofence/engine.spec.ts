import { NARRATION_CONFIG } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateGeofences, initialGeofenceState, reconcile } from './engine';
import type { GeofenceConfig, GeofencePlace, LocationFix, NarrationDecision } from './types';

import autoNarrationDisabled from './fixtures/auto-narration-disabled.json';
import boostedVenueBesideUnboosted from './fixtures/boosted-venue-beside-unboosted.json';
import cappedVenueDoesNotBlock from './fixtures/capped-venue-does-not-block.json';
import gpsGapThenReacquire from './fixtures/gps-gap-then-reacquire.json';
import jitterAcrossBoundary from './fixtures/jitter-across-boundary.json';
import overlappingRadiiPriority from './fixtures/overlapping-radii-priority.json';
import pilotWalkD1 from './fixtures/pilot-walk-d1.json';
import poorAccuracyFix from './fixtures/poor-accuracy-fix.json';
import reconcileAfterWindow from './fixtures/reconcile-after-window.json';
import singleStaleSample from './fixtures/single-stale-sample.json';
import sittingStillTenMinutes from './fixtures/sitting-still-ten-minutes.json';
import twoVenuesWithinTenMinutes from './fixtures/two-venues-within-ten-minutes.json';
import venueOverlapsEditorial from './fixtures/venue-overlaps-editorial.json';

interface Fixture {
  readonly places: readonly GeofencePlace[];
  readonly trace: readonly LocationFix[];
  readonly expect: readonly { t: number; placeId: string }[];
}

const config: GeofenceConfig = {
  geofenceDebounceMs: NARRATION_CONFIG.geofenceDebounceMs,
  narrationCooldownMs: NARRATION_CONFIG.narrationCooldownMs,
  commercialNarrationWindowMs: NARRATION_CONFIG.commercialNarrationWindowMs,
  commercialNarrationsPerWindow: NARRATION_CONFIG.commercialNarrationsPerWindow,
  safetyReconcileIntervalMs: NARRATION_CONFIG.safetyReconcileIntervalMs,
  locateMaxAccuracyM: NARRATION_CONFIG.locateMaxAccuracyM,
  gpsGapMs: NARRATION_CONFIG.gpsGapMs,
};

/** Replays a fixture's trace, also running reconcile on its configured interval (conventions §17.3). */
function replay(fixture: Fixture): { t: number; placeId: string }[] {
  const maxT = Math.max(...fixture.trace.map((f) => f.t), ...fixture.expect.map((e) => e.t));
  const minT = fixture.trace[0]?.t ?? 0;

  type Event = {
    readonly t: number;
    readonly kind: 'fix' | 'reconcile';
    readonly fix?: LocationFix;
  };
  const events: Event[] = [
    ...fixture.trace.map((fix): Event => ({ t: fix.t, kind: 'fix', fix })),
    ...Array.from(
      { length: Math.floor((maxT - minT) / config.safetyReconcileIntervalMs) + 1 },
      (_, index): Event => ({
        t: minT + index * config.safetyReconcileIntervalMs,
        kind: 'reconcile',
      }),
    ),
  ].toSorted((a, b) => a.t - b.t || (a.kind === 'fix' ? -1 : 1));

  let state = initialGeofenceState();
  const decisions: { t: number; placeId: string }[] = [];
  const record = (now: number, decision: NarrationDecision | null) => {
    if (decision !== null) decisions.push({ t: now, placeId: decision.placeId });
  };

  for (const event of events) {
    if (event.kind === 'fix' && event.fix !== undefined) {
      const result = evaluateGeofences({
        now: event.t,
        fix: event.fix,
        places: fixture.places,
        state,
        config,
      });
      state = result.state;
      record(event.t, result.decision);
    } else {
      const result = reconcile({ now: event.t, places: fixture.places, state, config });
      state = result.state;
      record(event.t, result.decision);
    }
  }
  return decisions;
}

describe('evaluateGeofences / reconcile — the fixture harness', () => {
  it.each([
    ['jitter-across-boundary', jitterAcrossBoundary],
    ['overlapping-radii-priority', overlappingRadiiPriority],
    ['venue-overlaps-editorial', venueOverlapsEditorial],
    ['boosted-venue-beside-unboosted', boostedVenueBesideUnboosted],
    ['sitting-still-ten-minutes', sittingStillTenMinutes],
    ['two-venues-within-ten-minutes', twoVenuesWithinTenMinutes],
    ['gps-gap-then-reacquire', gpsGapThenReacquire],
    ['auto-narration-disabled', autoNarrationDisabled],
    ['poor-accuracy-fix', poorAccuracyFix],
    ['single-stale-sample', singleStaleSample],
    ['capped-venue-does-not-block', cappedVenueDoesNotBlock],
    ['reconcile-after-window', reconcileAfterWindow],
    ['pilot-walk-d1', pilotWalkD1],
  ] as const)('%s', (_name, fixture) => {
    expect(replay(fixture as Fixture)).toEqual(fixture.expect);
  });
});

describe('reconcile', () => {
  it('is a no-op before any fix has ever arrived', () => {
    const result = reconcile({ now: 0, places: [], state: initialGeofenceState(), config });
    expect(result.decision).toBeNull();
  });
});
