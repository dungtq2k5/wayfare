import { describe, expect, it } from 'vitest';
import { afterManualPlay, decideOffer } from './queue';
import type { PlayerPlace } from './types';

const place = (id: string) => ({ id }) as unknown as PlayerPlace;

describe('decideOffer', () => {
  it('starts when nothing plays', () => {
    expect(decideOffer({ currentId: null, next: null }, place('a'))).toBe('start');
  });

  it('waits when something plays or is paused and the slot is empty', () => {
    expect(decideOffer({ currentId: 'a', next: null }, place('b'))).toBe('queued');
  });

  it('refuses when the slot is full, so the walk does not commit its choice', () => {
    expect(decideOffer({ currentId: 'a', next: place('b') }, place('c'))).toBe('refused');
  });

  it('never takes a Place that is playing or already waiting', () => {
    const state = { currentId: 'a', next: place('b') };
    expect(decideOffer(state, place('a'))).toBe('duplicate');
    expect(decideOffer(state, place('b'))).toBe('duplicate');
  });
});

describe('afterManualPlay', () => {
  it('leaves Up next as it was', () => {
    const waiting = place('b');
    expect(afterManualPlay({ currentId: 'a', next: waiting }, place('c'))).toBe(waiting);
    expect(afterManualPlay({ currentId: null, next: null }, place('c'))).toBeNull();
  });

  it('moves the waiting Place out of the slot when it is the one asked for', () => {
    expect(afterManualPlay({ currentId: 'a', next: place('b') }, place('b'))).toBeNull();
  });
});
