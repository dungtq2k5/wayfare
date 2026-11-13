import { describe, expect, it } from 'vitest';
import { boundaryKey, boundaryMiddle, closedRing, edgesCross, openRing } from './boundary-model';
import type { BoundaryState, Vertex } from './boundary-model';

const step = { lng: 0.001, lat: 0.001 };
const centre: Vertex = [106.7, 10.77];
const press = (state: BoundaryState, key: string, shift = false) =>
  boundaryKey(state, key, { shift, step, centre });
const square: Vertex[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('boundaryKey', () => {
  it('draws with Enter alone: the centre first, then a triangle', () => {
    let state: BoundaryState = { points: [], selected: null };
    for (let i = 0; i < 3; i++) state = press(state, 'Enter').state;
    expect(state.points).toHaveLength(3);
    expect(state.points[0]).toEqual(centre);
    expect(state.selected).toBe(2);
    expect(new Set(state.points.map(String)).size).toBe(3);
  });

  it('adds after the selected point, at the middle of its edge', () => {
    const { state } = press({ points: square, selected: 1 }, 'Enter');
    expect(state.points[2]).toEqual([1, 0.5]);
    expect(state.selected).toBe(2);
  });

  it('moves between points with Tab, and lets focus leave past the ends', () => {
    expect(press({ points: square, selected: null }, 'Tab').state.selected).toBe(0);
    expect(press({ points: square, selected: 1 }, 'Tab').state.selected).toBe(2);
    expect(press({ points: square, selected: 1 }, 'Tab', true).state.selected).toBe(0);
    expect(press({ points: square, selected: 3 }, 'Tab').handled).toBe(false);
    expect(press({ points: square, selected: 0 }, 'Tab', true).handled).toBe(false);
    expect(press({ points: [], selected: null }, 'Tab').handled).toBe(false);
  });

  it('moves the selected point with the arrows, ten steps with Shift', () => {
    const right = press({ points: square, selected: 0 }, 'ArrowRight').state.points[0]!;
    expect(right[0]).toBeCloseTo(0.001);
    const up = press({ points: square, selected: 0 }, 'ArrowUp', true).state.points[0]!;
    expect(up[1]).toBeCloseTo(0.01);
    expect(press({ points: square, selected: null }, 'ArrowUp').handled).toBe(false);
  });

  it('removes the selected point with Delete, keeping a selection', () => {
    const { state } = press({ points: square, selected: 3 }, 'Delete');
    expect(state.points).toHaveLength(3);
    expect(state.selected).toBe(2);
    expect(press({ points: square, selected: null }, 'Delete').handled).toBe(false);
  });

  it('lets the selection go with Escape', () => {
    expect(press({ points: square, selected: 2 }, 'Escape').state.selected).toBeNull();
  });
});

describe('rings', () => {
  it('closes and opens a ring', () => {
    expect(closedRing(square)).toHaveLength(5);
    expect(openRing(closedRing(square))).toEqual(square);
    expect(boundaryMiddle(square)).toEqual([0.5, 0.5]);
  });

  it('finds crossing edges in a figure eight, none in a square', () => {
    const eight: Vertex[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    expect(edgesCross(eight)).toBe(true);
    expect(edgesCross(square)).toBe(false);
  });
});
