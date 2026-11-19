// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../testing/render-hook';

/** The heard_places table, as far as heard-records uses it. */
const db = vi.hoisted(() => {
  const rows = new Map<string, { first: number; last: number }>();
  return {
    rows,
    run: vi.fn((_sql: string, [id, first, last]: [string, number, number]) => {
      const known = rows.get(id);
      rows.set(id, { first: known?.first ?? first, last });
      return Promise.resolve();
    }),
    all: vi.fn(() => Promise.resolve([...rows.keys()].map((place_id) => ({ place_id })))),
  };
});
vi.mock('./boot', () => ({ databaseReady: Promise.resolve(db) }));

const { clearHeard, loadHeard, markHeard, useHeardStore, useIsHeard } = await import('./heard');

describe('the Places heard on this phone', () => {
  beforeEach(() => {
    db.rows.clear();
    clearHeard();
  });

  it('records a Place once, keeping when it was first heard', async () => {
    await markHeard('p1', 100);
    await markHeard('p1', 200);
    expect(db.rows.get('p1')).toEqual({ first: 100, last: 200 });
    expect(useHeardStore.getState().ids).toEqual(new Set(['p1']));
  });

  it('reads what the phone heard at launch', async () => {
    db.rows.set('p2', { first: 1, last: 1 });
    await loadHeard();
    expect(useHeardStore.getState().ids).toEqual(new Set(['p2']));
  });

  it('tells a component at once when its Place is heard, and forgets on Forget this install', async () => {
    const rendered = await renderHook(() => useIsHeard('p3'));
    expect(rendered.current()).toBe(false);
    await act(() => markHeard('p3', 1));
    expect(rendered.current()).toBe(true);
    act(() => clearHeard());
    expect(rendered.current()).toBe(false);
  });
});
