import { describe, expect, it } from 'vitest';
import { boostSetChange, boostsOverSlots } from './boosts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 9, minute));
const row = (id: string, placeId: string, minute: number) => ({
  id,
  placeId,
  startsAt: at(minute),
});

describe('the boosts over the slots', () => {
  const live = [row('b', 'p2', 2), row('a', 'p1', 1), row('c', 'p3', 3)];

  it('end newest first, the oldest keeping their slots', () => {
    expect(boostsOverSlots(live, 1).map((boost) => boost.placeId)).toEqual(['p3', 'p2']);
    expect(boostsOverSlots(live, 0).map((boost) => boost.placeId)).toEqual(['p3', 'p2', 'p1']);
  });

  it('are none when the slots suffice', () => {
    expect(boostsOverSlots(live, 3)).toEqual([]);
    expect(boostsOverSlots(live, 5)).toEqual([]);
  });

  it('break a tie by id', () => {
    const tied = [row('y', 'p2', 1), row('x', 'p1', 1)];
    expect(boostsOverSlots(tied, 1).map((boost) => boost.placeId)).toEqual(['p2']);
  });
});

describe('a complete set', () => {
  const live = [row('a', 'p1', 1), row('b', 'p2', 2)];

  it('ends what it leaves out and starts what is new', () => {
    const change = boostSetChange(live, ['p2', 'p3']);
    expect(change.end.map((boost) => boost.placeId)).toEqual(['p1']);
    expect(change.start).toEqual(['p3']);
  });

  it('equal to the live set changes nothing', () => {
    expect(boostSetChange(live, ['p2', 'p1'])).toEqual({ end: [], start: [] });
  });
});
