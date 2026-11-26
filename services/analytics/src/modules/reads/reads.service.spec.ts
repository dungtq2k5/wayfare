import { geohashOf } from '@wayfare/contracts';
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ReadsService } from './reads.service';

const prisma = {
  rollupDay: { findFirst: vi.fn() },
  placeDailyStats: { findMany: vi.fn(), groupBy: vi.fn() },
  activityDailyStats: { groupBy: vi.fn() },
  runtimeActivityHourly: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};
const redis = { pfcount: vi.fn() };
const reads = new ReadsService(prisma as unknown as PrismaService, redis as never);
const range = { fromDay: '2026-11-02', toDay: '2026-11-03' };
const day = (value: string) => new Date(`${value}T00:00:00Z`);

beforeEach(() => {
  vi.resetAllMocks();
  prisma.rollupDay.findFirst.mockResolvedValue(null);
});

describe('the analytics reads (api-endpoints-plan §7)', () => {
  it('reads no rows for no Places, and says no data before the first rollup', async () => {
    await expect(reads.placeDailyStats({ range, placeIds: [] })).resolves.toEqual({
      days: [],
      dataThrough: undefined,
    });
    expect(prisma.placeDailyStats.findMany).not.toHaveBeenCalled();
  });

  it('counts a sum the rollup left empty as zero, and orders languages by starts, then by tag', async () => {
    prisma.rollupDay.findFirst.mockResolvedValue({ day: day('2026-11-03') });
    prisma.activityDailyStats.groupBy
      .mockResolvedValueOnce([{ day: day('2026-11-02'), _sum: { sessions: null } }])
      .mockResolvedValueOnce([
        { lang: 'vi', _sum: { narrationsStarted: 3, narrationsCompleted: null } },
        { lang: 'en', _sum: { narrationsStarted: 3, narrationsCompleted: 2 } },
        { lang: 'ja', _sum: { narrationsStarted: null, narrationsCompleted: null } },
      ]);
    prisma.placeDailyStats.groupBy.mockResolvedValue([
      { day: day('2026-11-02'), _sum: { geofenceStarted: null, tapStarted: 1, qrStarted: null } },
    ]);
    const answer = await reads.overview({ range });
    expect(answer.days[0]).toMatchObject({
      day: '2026-11-02',
      sessions: 0,
      tapStarted: 1,
      qrStarted: 0,
    });
    expect(answer.days[1]).toMatchObject({ day: '2026-11-03', sessions: 0, geofenceStarted: 0 });
    expect(answer.languages).toEqual([
      { lang: 'en', narrationsStarted: 3, narrationsCompleted: 2 },
      { lang: 'vi', narrationsStarted: 3, narrationsCompleted: 0 },
      { lang: 'ja', narrationsStarted: 0, narrationsCompleted: 0 },
    ]);
    expect(answer.dataThrough).toBe('2026-11-03');
  });

  it.each([
    [analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_STARTED, 'narrationsStarted'],
    [analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_LISTEN_MS, 'listenMsSum'],
    [analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_COMPLETED, 'narrationsCompleted'],
  ])(
    'ranks the top Places by the metric asked (%s), its empty sums as zero',
    async (metric, order) => {
      prisma.placeDailyStats.groupBy.mockResolvedValue([
        {
          placeId: 'p1',
          _sum: { narrationsStarted: null, narrationsCompleted: null, listenMsSum: null },
        },
      ]);
      const answer = await reads.topPlaces({ range, metric, limit: 500 });
      expect(prisma.placeDailyStats.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ _sum: { [order]: 'desc' } }, { placeId: 'asc' }],
          take: 100,
        }),
      );
      expect(answer.places).toEqual([
        { placeId: 'p1', narrationsStarted: 0, narrationsCompleted: 0, listenMsSum: '0' },
      ]);
    },
  );

  it('draws the heat map’s cells inside the box, largest first then by cell, through the newest computation', async () => {
    const a = geohashOf(10.775, 106.7, 7);
    const b = geohashOf(10.776, 106.701, 7);
    const outside = geohashOf(21.0, 105.8, 7);
    prisma.$queryRaw.mockResolvedValue([
      { cell: b, estimate: 5n, computed: new Date('2026-11-03T05:00:00Z') },
      { cell: a, estimate: 5n, computed: new Date('2026-11-03T04:00:00Z') },
      { cell: outside, estimate: 9n, computed: new Date('2026-11-03T06:00:00Z') },
    ]);
    const box = { minLat: 10.7, maxLat: 10.8, minLng: 106.6, maxLng: 106.8 };
    const answer = await reads.heatmap({ range, utcHours: [], ...box });
    expect(answer.cells.map((cell) => cell.cell)).toEqual(
      [a, b].toSorted((x, y) => (x < y ? -1 : 1)),
    );
    expect(answer.computedThrough).toBeDefined();
    prisma.$queryRaw.mockResolvedValue([]);
    expect(
      (await reads.heatmap({ range, utcHours: [9, 30], ...box })).computedThrough,
    ).toBeUndefined();
  });

  it('lists this hour’s active Areas, busiest first then by id, leaving quiet ones out', async () => {
    redis.pfcount.mockImplementation((key: string) =>
      Promise.resolve(key.includes('quiet') ? 0 : 4),
    );
    const answer = await reads.currentActivity({ areaIds: ['b', 'quiet', 'a'] });
    expect(answer.areas).toEqual([
      { areaId: 'a', estimate: 4 },
      { areaId: 'b', estimate: 4 },
    ]);
  });
});
