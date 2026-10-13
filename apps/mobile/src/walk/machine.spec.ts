import { describe, expect, it } from 'vitest';
import { initialWalk, minutesOn, step } from './machine';
import type { WalkEvent, WalkRecord } from './machine';

const UNDO = 6_000;

/** Applies events in order at the given times. */
function run(events: readonly (readonly [WalkEvent, number])[], from = initialWalk()): WalkRecord {
  return events.reduce((walk, [event, now]) => step(walk, event, now, UNDO).walk, from);
}

const ON: readonly (readonly [WalkEvent, number])[] = [
  [{ type: 'begin', areaId: 'area-1' }, 0],
  [{ type: 'ready', background: true }, 10],
];

describe('the walk machine', () => {
  it('goes off → starting → on, and starts the location updates', () => {
    const starting = step(initialWalk(), { type: 'begin', areaId: 'a' }, 0, UNDO);
    expect(starting.walk.phase).toBe('starting');
    const on = step(starting.walk, { type: 'ready', background: true }, 10, UNDO);
    expect(on.walk).toMatchObject({ phase: 'on', startedAt: 10 });
    expect(on.effects).toEqual(['start-updates']);
  });

  it('is foreground-only when the background was refused', () => {
    expect(
      run([
        [{ type: 'begin', areaId: null }, 0],
        [{ type: 'ready', background: false }, 1],
      ]).phase,
    ).toBe('foreground-only');
  });

  it('ignores a second begin and a ready that nobody asked for (a double tap)', () => {
    const once = run(ON);
    expect(step(once, { type: 'begin', areaId: null }, 20, UNDO).walk).toBe(once);
    expect(step(initialWalk(), { type: 'ready', background: true }, 0, UNDO).walk.phase).toBe(
      'off',
    );
  });

  it('abandons a walk whose permission flow ended without one', () => {
    expect(
      run([
        [{ type: 'begin', areaId: null }, 0],
        [{ type: 'abandon' }, 1],
      ]).phase,
    ).toBe('off');
  });

  it('counts a Place once and only while the walk is on', () => {
    const walk = run([
      ...ON,
      [{ type: 'heard', placeId: 'p1' }, 20],
      [{ type: 'heard', placeId: 'p1' }, 21],
      [{ type: 'heard', placeId: 'p2' }, 22],
    ]);
    expect(walk.heard).toEqual(['p1', 'p2']);
    expect(step(initialWalk(), { type: 'heard', placeId: 'p9' }, 0, UNDO).walk.heard).toEqual([]);
  });

  it('stops at once, and Undo within the window resumes the same walk', () => {
    const heard = run([...ON, [{ type: 'heard', placeId: 'p1' }, 20]]);
    const stopped = step(heard, { type: 'stop' }, 100, UNDO);
    expect(stopped.walk).toMatchObject({ phase: 'ended', endReason: 'stopped' });
    expect(stopped.effects).toEqual(['stop-updates']);
    const resumed = step(stopped.walk, { type: 'undo' }, 100 + UNDO, UNDO);
    expect(resumed.walk).toMatchObject({ phase: 'on', startedAt: 10, heard: ['p1'] });
    expect(resumed.effects).toEqual(['start-updates']);
  });

  it('does not Undo after the window', () => {
    const stopped = step(run(ON), { type: 'stop' }, 100, UNDO).walk;
    expect(step(stopped, { type: 'undo' }, 100 + UNDO + 1, UNDO).walk).toBe(stopped);
    expect(step(stopped, { type: 'settle' }, 100 + UNDO + 1, UNDO).walk.phase).toBe('off');
  });

  it('a second Stop changes nothing', () => {
    const stopped = step(run(ON), { type: 'stop' }, 100, UNDO).walk;
    expect(step(stopped, { type: 'stop' }, 101, UNDO).walk).toBe(stopped);
  });

  it('an idle end keeps its notice until it is dismissed, and says why', () => {
    const idle = step(run(ON), { type: 'idle' }, 5_000, UNDO);
    expect(idle.walk).toMatchObject({ phase: 'ended', endReason: 'idle', noticeDismissed: false });
    expect(idle.effects).toEqual(['stop-updates', 'idle-notification']);
    expect(step(idle.walk, { type: 'undo' }, 5_001, UNDO).walk).toBe(idle.walk);
    expect(step(idle.walk, { type: 'dismiss-notice' }, 5_002, UNDO).walk.phase).toBe('off');
  });

  it('a launch that finds the walk on with no task knows the system stopped it; Stop and idle never do', () => {
    const killed = step(run(ON), { type: 'killed' }, 9_000, UNDO).walk;
    expect(killed).toMatchObject({ phase: 'ended', endReason: 'system', noticeDismissed: false });
    // After a clean end the same event changes nothing.
    const stopped = step(run(ON), { type: 'stop' }, 100, UNDO).walk;
    expect(step(stopped, { type: 'killed' }, 200, UNDO).walk).toBe(stopped);
    const idle = step(run(ON), { type: 'idle' }, 100, UNDO).walk;
    expect(step(idle, { type: 'killed' }, 200, UNDO).walk).toBe(idle);
  });

  it('moves between on and foreground-only as the background permission changes', () => {
    const revoked = step(run(ON), { type: 'background-revoked' }, 30, UNDO).walk;
    expect(revoked.phase).toBe('foreground-only');
    expect(step(revoked, { type: 'background-granted' }, 31, UNDO).walk.phase).toBe('on');
  });

  it('keeps the engine state only while a walk is running', () => {
    const engine = { entries: {}, lastFiredAt: { p1: 1 }, venueDecisionsAt: [], lastFix: null };
    expect(step(run(ON), { type: 'engine', engine }, 40, UNDO).walk.engine).toBe(engine);
    expect(step(initialWalk(), { type: 'engine', engine }, 40, UNDO).walk.engine).not.toBe(engine);
    expect(step(run(ON), { type: 'engine', engine }, 40, UNDO).walk.lastFixAt).toBe(40);
  });

  it('counts whole minutes on', () => {
    const walk = run(ON);
    expect(minutesOn(walk, 10 + 59_999)).toBe(0);
    expect(minutesOn(walk, 10 + 24 * 60_000)).toBe(24);
    expect(minutesOn(initialWalk(), 99)).toBe(0);
  });
});
