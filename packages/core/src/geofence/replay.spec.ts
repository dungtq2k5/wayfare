import { PlaceKind } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateGeofences, initialGeofenceState, reconcile } from './engine';
import { replayEngineCalls } from './replay';
import type { LoggedEngineCall } from './replay';
import type { GeofenceConfig, GeofencePlace } from './types';

const config: GeofenceConfig = {
  geofenceDebounceMs: 3_000,
  narrationCooldownMs: 300_000,
  commercialNarrationWindowMs: 600_000,
  commercialNarrationsPerWindow: 1,
  safetyReconcileIntervalMs: 5_000,
  locateMaxAccuracyM: 100,
  gpsGapMs: 15_000,
};
const places: GeofencePlace[] = [
  {
    id: 'a',
    kind: PlaceKind.EDITORIAL,
    location: { lat: 10.77, lng: 106.7 },
    triggerRadiusM: 30,
    narrationPriority: 50,
    autoNarrationEnabled: true,
  },
];

/** What a phone does with a player that refuses the first two offers, logged as the app logs it. */
function phoneWalk(): LoggedEngineCall[] {
  const log: LoggedEngineCall[] = [];
  let state = initialGeofenceState();
  let refusals = 2;
  const call = (kind: 'evaluate' | 'reconcile', now: number) => {
    const fix = { lat: 10.77, lng: 106.7, accuracyM: 10 };
    const result =
      kind === 'evaluate'
        ? evaluateGeofences({ now, fix: { t: now, ...fix }, places, state, config })
        : reconcile({ now, places, state, config });
    const decision = result.decision?.placeId ?? null;
    let accepted: boolean | null = null;
    let next = result.state;
    if (decision !== null) {
      accepted = refusals === 0;
      if (!accepted) {
        refusals -= 1;
        next = {
          ...next,
          lastFiredAt: state.lastFiredAt,
          venueDecisionsAt: state.venueDecisionsAt,
        };
      }
    }
    state = next;
    log.push({ kind, now, fix: kind === 'evaluate' ? fix : null, decision, accepted });
    return decision;
  };
  call('evaluate', 0);
  call('evaluate', 5_000); // decided, refused
  if (call('evaluate', 10_000) === null) call('reconcile', 10_000); // refused again
  if (call('evaluate', 15_000) === null) call('reconcile', 15_000); // taken
  return log;
}

describe('replayEngineCalls', () => {
  it('reproduces every decision of a walk with refusals', () => {
    const log = phoneWalk();
    expect(log.filter((entry) => entry.accepted === false)).toHaveLength(2);
    expect(replayEngineCalls(log, places, config)).toEqual([]);
  });

  it('reports a call whose decision the phone logged differently', () => {
    const log = phoneWalk();
    const wrong = log.map((entry) =>
      entry.decision === null ? entry : { ...entry, decision: 'x' },
    );
    expect(replayEngineCalls(wrong, places, config).length).toBeGreaterThan(0);
  });

  it('would diverge if a refusal were committed like an acceptance', () => {
    const forgotten = phoneWalk().map((entry) =>
      entry.accepted === false ? { ...entry, accepted: true } : entry,
    );
    expect(replayEngineCalls(forgotten, places, config).length).toBeGreaterThan(0);
  });

  it('replays each call with the gap threshold the phone ran with', () => {
    const fix = { lat: 10.77, lng: 106.7, accuracyM: 10 };
    const slow: LoggedEngineCall[] = [
      { kind: 'evaluate', now: 0, fix, decision: null, gpsGapMs: 60_000 },
      { kind: 'evaluate', now: 20_000, fix, decision: 'a', gpsGapMs: 60_000 },
    ];
    expect(replayEngineCalls(slow, places, config)).toEqual([]);
    const withoutGap = slow.map(({ gpsGapMs: _ignored, ...call }) => call);
    expect(replayEngineCalls(withoutGap, places, config)).not.toEqual([]);
  });
});
