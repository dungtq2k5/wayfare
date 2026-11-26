// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { database } from '../client/db';
import {
  beginTour,
  FINISHED_EVENT,
  finishedStories,
  recordFinished,
  tourStartedAt,
} from './progress';

describe('a tour’s progress on this browser (round 39’s K8)', () => {
  it('records a finished story, tells the page at once, and lists it by Place', async () => {
    const heard = vi.fn<(detail: unknown) => void>();
    window.addEventListener(FINISHED_EVENT, (event) => {
      heard((event as CustomEvent<unknown>).detail);
    });
    await recordFinished('p1', 100);
    await recordFinished('p1', 200);
    expect(heard).toHaveBeenLastCalledWith({ placeId: 'p1', at: 200 });
    expect(await finishedStories()).toEqual(new Map([['p1', 200]]));
  });

  it('begins a tour once: its first Play is its start', async () => {
    expect(await tourStartedAt('t1')).toBeNull();
    expect(await beginTour('t1', 1_000)).toBe(1_000);
    expect(await beginTour('t1', 5_000)).toBe(1_000);
    expect(await tourStartedAt('t1')).toBe(1_000);
  });

  it('still tells the page, and lists nothing, when the database is unavailable', async () => {
    const db = await database();
    vi.spyOn(db, 'put').mockRejectedValueOnce(new Error('private window'));
    vi.spyOn(db, 'getAll').mockRejectedValueOnce(new Error('private window'));
    const heard = vi.fn();
    window.addEventListener(FINISHED_EVENT, heard);
    await recordFinished('p2', 300);
    expect(heard).toHaveBeenCalled();
    expect(await finishedStories()).toEqual(new Map());
  });
});
