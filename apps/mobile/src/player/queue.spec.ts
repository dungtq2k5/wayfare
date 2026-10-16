import { describe, expect, it } from 'vitest';
import { afterManualPlay, decideOffer, relanguagePlan } from './queue';
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

describe('relanguagePlan', () => {
  it('lets a story already sounding finish in its language', () => {
    expect(relanguagePlan({ source: 'file', lang: 'en' }, 'ja')).toBe('keep');
    expect(relanguagePlan({ source: 'device', lang: 'en' }, 'ja')).toBe('keep');
  });

  it('starts a story still being prepared again in the new language', () => {
    expect(relanguagePlan({ source: null, lang: 'en' }, 'ja')).toBe('restart');
    expect(relanguagePlan({ source: null, lang: 'ja' }, 'ja')).toBe('keep');
  });
});
