import { describe, expect, it } from 'vitest';
import { nextPause } from './pause-machine';
import type { PauseEvent } from './pause-machine';
import type { PauseReason } from './types';

const run = (events: readonly PauseEvent[]): PauseReason | null =>
  events.reduce<PauseReason | null>((state, event) => nextPause(state, event), null);

describe('nextPause', () => {
  it('a call: playing → paused by the system → playing again on its own', () => {
    expect(run([{ type: 'status', playing: false }])).toBe('system');
    expect(
      run([
        { type: 'status', playing: false },
        { type: 'status', playing: true },
      ]),
    ).toBeNull();
  });

  it('another app’s audio: paused by the system, and it stays paused until the tourist resumes', () => {
    const paused: PauseEvent[] = [{ type: 'status', playing: false }];
    expect(run(paused)).toBe('system');
    expect(run([...paused, { type: 'user-resume' }])).toBeNull();
  });

  it('the tourist’s own pause is theirs, not the system’s', () => {
    expect(run([{ type: 'user-pause' }, { type: 'status', playing: false }])).toBe('user');
    expect(run([{ type: 'user-pause' }, { type: 'user-resume' }])).toBeNull();
  });

  it('headphones unplugged pause with Resume and never resume by themselves', () => {
    expect(run([{ type: 'headphones' }, { type: 'status', playing: false }])).toBe('headphones');
    expect(run([{ type: 'headphones' }, { type: 'status', playing: true }])).toBe('headphones');
    expect(run([{ type: 'headphones' }, { type: 'user-resume' }])).toBeNull();
  });
});
