import { initialGeofenceState, replayEngineCalls } from '@wayfare/core';
import type { GeofencePlace, LocationFix } from '@wayfare/core';
import pilotWalk from '@wayfare/core/fixtures/pilot-walk-d1.json';
import { NARRATION_CONFIG } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { handleFix } from './handler';
import type { EngineCall, HandlerState } from './handler';
import { advanceToDecision } from './trace-stepper';

const places = pilotWalk.places as GeofencePlace[];
const trace = pilotWalk.trace as LocationFix[];
const config = NARRATION_CONFIG;

/** The simulation's loop over the real fix handler, with a player that takes every offer. */
function simulate() {
  let state: HandlerState = { engine: initialGeofenceState(), retry: [] };
  const calls: EngineCall[] = [];
  const offered: string[] = [];
  const feed = (fix: LocationFix) => {
    const before = offered.length;
    state = handleFix({
      fix,
      now: fix.t,
      intervalMs: config.gpsThrottleMs,
      config,
      state,
      deps: {
        places: () => places,
        offer: (id) => {
          offered.push(id);
          return 'accepted';
        },
        log: (call) => calls.push(call),
      },
    }).state;
    return Promise.resolve(offered.length > before);
  };
  return { feed, calls, offered };
}

describe('the simulated walk', () => {
  it('yields one decision per step, in the fixture order', async () => {
    const { feed, offered } = simulate();
    let cursor = 0;
    const steps: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const result = await advanceToDecision(trace, cursor, feed);
      cursor = result.cursor;
      if (!result.decided) break;
      steps.push(offered.at(-1)!);
      expect(offered).toHaveLength(steps.length);
    }
    expect(steps).toEqual(pilotWalk.expect.map((entry) => entry.placeId));
  });

  it('makes the decisions the replay tool reproduces', async () => {
    const { feed, calls, offered } = simulate();
    let cursor = 0;
    for (;;) {
      const result = await advanceToDecision(trace, cursor, feed);
      cursor = result.cursor;
      if (!result.decided) break;
    }
    expect(offered.length).toBeGreaterThan(0);
    expect(replayEngineCalls(calls, places, config)).toEqual([]);
  });

  it('holds at the end of the trace', async () => {
    const result = await advanceToDecision(trace, trace.length, () => Promise.resolve(true));
    expect(result).toEqual({ cursor: trace.length, decided: false });
  });
});
