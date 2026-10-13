import { describe, expect, it } from 'vitest';
import { gapMsFor, initialMotion, stepMotion, stoppedBySystem } from './motion';
import type { MotionConfig, MotionState } from './motion';

const config: MotionConfig = {
  walkIdleStopMs: 30 * 60_000,
  walkIdleRadiusM: 50,
  stationaryAfterMs: 2 * 60_000,
  locateMaxAccuracyM: 100,
};
const MIN = 60_000;
/** A point `metres` north of (10.77, 106.7): a degree of latitude is about 111 km. */
const at = (t: number, metres = 0, accuracyM = 10) => ({
  t,
  lat: 10.77 + metres / 111_000,
  lng: 106.7,
  accuracyM,
});

function feed(
  state: MotionState,
  fixes: ReturnType<typeof at>[],
): { state: MotionState; idleAt: number | null; changes: number[] } {
  let idleAt: number | null = null;
  const changes: number[] = [];
  for (const fix of fixes) {
    const result = stepMotion(state, fix, config);
    state = result.state;
    if (result.cadenceChanged) changes.push(fix.t);
    if (result.idle && idleAt === null) idleAt = fix.t;
  }
  return { state, idleAt, changes };
}

describe('stepMotion', () => {
  it('goes idle after 30 minutes inside the 50 m circle', () => {
    const fixes = Array.from({ length: 40 }, (_, i) => at(i * MIN));
    expect(feed(initialMotion, fixes).idleAt).toBe(30 * MIN);
  });

  it('a step outside the circle resets the clock', () => {
    const fixes = [
      ...Array.from({ length: 20 }, (_, i) => at(i * MIN)),
      at(20 * MIN, 120),
      ...Array.from({ length: 35 }, (_, i) => at((21 + i) * MIN, 120)),
    ];
    // 20 min still, a move, then 45 more minutes still: idle 30 minutes after the move.
    expect(feed(initialMotion, fixes).idleAt).toBe(50 * MIN);
  });

  it('GPS wander inside the circle does not reset it', () => {
    const wander = [0, 30, -20, 40, -35, 10];
    const fixes = Array.from({ length: 35 }, (_, i) => at(i * MIN, wander[i % wander.length]));
    expect(feed(initialMotion, fixes).idleAt).toBe(30 * MIN);
  });

  it('a weak fix is ignored: it neither moves the tourist nor ends the idle clock', () => {
    const fixes = [at(0), at(1 * MIN, 500, 300), at(31 * MIN)];
    expect(feed(initialMotion, fixes).idleAt).toBe(31 * MIN);
  });

  it('slows down after 2 minutes still and speeds up again at the first fix outside the circle', () => {
    const result = feed(initialMotion, [
      at(0),
      at(1 * MIN),
      at(2 * MIN),
      at(3 * MIN),
      at(3.5 * MIN, 200),
    ]);
    expect(result.changes).toEqual([2 * MIN, 3.5 * MIN]);
    expect(result.state.cadence).toBe('moving');
  });
});

describe('gapMsFor', () => {
  it('never drops below the engine’s gap, and follows two intervals above it', () => {
    expect(gapMsFor(15_000, 5_000)).toBe(15_000);
    expect(gapMsFor(15_000, 30_000)).toBe(60_000);
  });
});

describe('stoppedBySystem', () => {
  const base = { taskRunning: true, lastFixAt: 1_000, now: 61_000, silenceMs: 120_000 };
  it('is false for a live walk with a recent fix', () => {
    expect(stoppedBySystem(base)).toBe(false);
  });
  it('is true with no task running', () => {
    expect(stoppedBySystem({ ...base, taskRunning: false })).toBe(true);
  });
  it('is true when a restored task runs but the walk went silent', () => {
    expect(stoppedBySystem({ ...base, now: 200_000 })).toBe(true);
  });
});
