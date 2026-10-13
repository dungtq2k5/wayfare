import { initialGeofenceState } from '@wayfare/core';
import type { GeofenceConfig, GeofencePlace } from '@wayfare/core';
import { PlaceKind } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { handleFix } from './handler';
import type { EngineCall, HandlerDeps, HandlerState, OfferOutcome } from './handler';

const config: GeofenceConfig = {
  geofenceDebounceMs: 3_000,
  narrationCooldownMs: 300_000,
  commercialNarrationWindowMs: 600_000,
  commercialNarrationsPerWindow: 1,
  safetyReconcileIntervalMs: 5_000,
  locateMaxAccuracyM: 100,
  gpsGapMs: 15_000,
};
const place = (id: string, lat: number): GeofencePlace => ({
  id,
  kind: PlaceKind.EDITORIAL,
  location: { lat, lng: 106.7 },
  triggerRadiusM: 30,
  narrationPriority: 50,
  autoNarrationEnabled: true,
});
const A = place('a', 10.77);
const fixAt = (t: number, lat = 10.77, accuracyM = 10) => ({ t, lat, lng: 106.7, accuracyM });

function harness(outcomes: OfferOutcome[]) {
  const calls: EngineCall[] = [];
  const offered: string[] = [];
  const deps: HandlerDeps = {
    places: () => [A],
    offer: (id) => {
      offered.push(id);
      return outcomes.shift() ?? 'accepted';
    },
    log: (call) => calls.push(call),
  };
  let state: HandlerState = { engine: initialGeofenceState(), retry: [] };
  let weak = false;
  const feed = (t: number, lat = 10.77, accuracyM = 10) => {
    const result = handleFix({
      fix: fixAt(t, lat, accuracyM),
      now: t,
      intervalMs: 5_000,
      config,
      state,
      deps,
    });
    state = result.state;
    weak = result.weak;
  };
  return { feed, calls, offered, state: () => state, weak: () => weak };
}

describe('handleFix', () => {
  it('commits the whole state when the player takes the Place', () => {
    const h = harness(['accepted']);
    h.feed(0);
    h.feed(5_000);
    expect(h.offered).toEqual(['a']);
    expect(h.state().engine.lastFiredAt.a).toBe(5_000);
    expect(h.state().retry).toEqual([]);
  });

  it('keeps a refused Place unfired and offers it again by reconcile until taken', () => {
    const h = harness(['refused', 'refused', 'accepted']);
    h.feed(0);
    h.feed(5_000); // confirmed, offered, refused
    expect(h.state().engine.lastFiredAt.a).toBeUndefined();
    expect(h.state().retry).toEqual(['a']);
    expect(h.state().engine.entries.a?.confirmed).toBe(true);
    h.feed(10_000); // evaluate: nothing new → reconcile offers it again, refused again
    h.feed(15_000); // taken
    expect(h.offered).toEqual(['a', 'a', 'a']);
    expect(h.state().engine.lastFiredAt.a).toBe(15_000);
    expect(h.state().retry).toEqual([]);
    expect(h.calls.map((call) => call.kind)).toEqual([
      'evaluate',
      'evaluate',
      'evaluate',
      'reconcile',
      'evaluate',
      'reconcile',
    ]);
    expect(h.calls.map((call) => call.accepted)).toEqual([null, false, null, false, null, true]);
  });

  it('never plays a refused Place the tourist walked away from', () => {
    const h = harness(['refused']);
    h.feed(0);
    h.feed(5_000);
    h.feed(10_000, 10.78); // ~1.1 km away: the entry is deleted
    h.feed(15_000, 10.78);
    expect(h.offered).toEqual(['a']);
    expect(h.state().retry).toEqual([]);
    expect(h.state().engine.lastFiredAt.a).toBeUndefined();
  });

  it('skips a Place whose record is gone, and does not retry it', () => {
    const h = harness(['skipped']);
    h.feed(0);
    h.feed(5_000);
    expect(h.state().retry).toEqual([]);
    expect(h.state().engine.lastFiredAt.a).toBe(5_000);
    expect(h.calls.at(-1)?.accepted).toBe(true);
  });

  it('a weak fix sets the note and reaches the engine only as a reconcile', () => {
    const h = harness([]);
    h.feed(0, 10.77, 300);
    expect(h.weak()).toBe(true);
    expect(h.calls.map((call) => call.kind)).toEqual(['reconcile']);
    h.feed(5_000);
    expect(h.weak()).toBe(false);
  });

  it('follows the cadence: a 30 s gap keeps a pending entry that a 5 s cadence would drop', () => {
    const slow = harness([]);
    const run = (h: ReturnType<typeof harness>, intervalMs: number) => {
      const state = { engine: initialGeofenceState(), retry: [] as string[] };
      const deps: HandlerDeps = {
        places: () => [A],
        offer: () => 'accepted',
        log: () => undefined,
      };
      const first = handleFix({ fix: fixAt(0), now: 0, intervalMs, config, state, deps });
      return handleFix({
        fix: fixAt(30_000),
        now: 30_000,
        intervalMs,
        config,
        state: first.state,
        deps,
      });
    };
    // At the 5 s cadence the entry (seen at 0) is 30 s old, past the 15 s gap: dropped and re-seen.
    expect(run(slow, 5_000).state.engine.lastFiredAt.a).toBeUndefined();
    // At the 30 s cadence the gap is 60 s: the entry survives and confirms.
    expect(run(slow, 30_000).state.engine.lastFiredAt.a).toBe(30_000);
  });
});
