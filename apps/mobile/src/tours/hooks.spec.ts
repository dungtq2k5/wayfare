// @vitest-environment happy-dom
import { newId } from '@wayfare/contracts';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { memoryKv, tourRecord } from '../testing/shell-fakes';
import { renderHook, settle } from '../testing/render-hook';

vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));
vi.mock('../data/boot', async () => {
  const { openTestDatabase } = await import('../db/test-database');
  const { migrate } = await import('../db/migrate');
  const db = openTestDatabase();
  await migrate(db);
  return { databaseReady: Promise.resolve(db) };
});

const { databaseReady } = await import('../data/boot');
const { useLocalTour, useLocalTours } = await import('./hooks');
const { markStoryFinished, useFinishedStore } = await import('./finished');
const db = await databaseReady;

const AREA = newId();
const [a, b, c] = [newId(), newId(), newId()];

async function place(id: string, lat: number) {
  const record = { id, areaId: AREA, location: { lat, lng: 106.7 } };
  await db.run(
    `INSERT INTO place_records (place_id, lang, area_id, kind, category_code, lat, lng, record_json)
     VALUES (?, 'en', ?, 'EDITORIAL', 'CAFE', ?, 106.7, ?)`,
    [id, AREA, lat, JSON.stringify(record)],
  );
}
async function tour(record: ReturnType<typeof tourRecord>) {
  await db.run(
    'INSERT INTO tour_records (tour_id, lang, area_id, record_json) VALUES (?, ?, ?, ?)',
    [record.id, 'en', record.areaId, JSON.stringify(record)],
  );
}

await place(a, 10.77);
await place(b, 10.78);
const walkable = tourRecord(newId(), AREA, [a, b]);
const tooShort = tourRecord(newId(), AREA, [a, c]);
await tour(walkable);
await tour(tooShort);

describe('the tours on this phone (TM1, TM6b)', () => {
  it('lists an area’s tours with two live stops at least, each with its progress', async () => {
    const rendered = await renderHook(() => useLocalTours(AREA));
    await settle();
    const rows = rendered.current().data!;
    expect(rows.map((row) => row.tour.record.id)).toEqual([walkable.id]);
    expect(rows[0]).toMatchObject({ start: null, progress: { durationMs: null } });
  });

  it('asks nothing before an area is chosen, or a tour named', async () => {
    const tours = await renderHook(() => useLocalTours(null));
    const one = await renderHook(() => useLocalTour(null));
    await settle();
    expect(tours.current().fetchStatus).toBe('idle');
    expect(one.current().fetchStatus).toBe('idle');
  });

  it('reads one tour, even one too short for the list, and none the phone doesn’t hold', async () => {
    const shown = await renderHook(() => useLocalTour(tooShort.id));
    const missing = await renderHook(() => useLocalTour(newId()));
    await settle();
    expect(shown.current().data?.tour.liveCount).toBe(1);
    expect(missing.current().data).toBeNull();
  });

  it('reads progress again when a story is played to its end', async () => {
    await db.run('INSERT INTO tour_progress (tour_id, started_at) VALUES (?, ?)', [walkable.id, 1]);
    const rendered = await renderHook(() => useLocalTour(walkable.id));
    await settle();
    expect(rendered.current().data?.start).toEqual({ startedAt: 1, finishedSeenAt: null });
    const version = useFinishedStore.getState().version;
    await act(() => markStoryFinished(a, 5));
    await settle();
    expect(useFinishedStore.getState().version).toBe(version + 1);
    expect(rendered.current().data?.progress).toMatchObject({ next: 1 });
    expect([...rendered.current().data!.progress.played]).toEqual([0]);
  });
});
