// The dashboards' reads (the analytics side): the owner's A-4 rows; the overview's days and
// languages; the top Places; the heatmap's band crossing UTC midnight, inside its box, the
// suppressed cells absent; the runtime lane's hours and this hour so far; a 94-day range refused.
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { geohashOf, newId, runtimeKey } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { analyticsServices } from '../setup/services';
import { codeOf, consenting, ingest, started } from '../setup/fixtures';

const services = analyticsServices();
beforeEach(() => services.reset());
afterAll(() => services.close());

const now = new Date('2026-11-07T05:00:00Z');
const range = { fromDay: '2026-11-04', toDay: '2026-11-06' };

describe('the rollups’ reads', () => {
  it('a Place’s days, the overview and the top Places', async () => {
    const [a, b] = [newId(), newId()];
    const id = await consenting(services);
    const at = new Date('2026-11-05T03:00:00Z');
    await ingest(
      services,
      id,
      [started(a, at), started(a, at, { lang: 'vi' }), started(b, at)],
      at,
    );
    await services.dailyRollup.run(now);

    const stats = await services.reads.placeDailyStats({ placeIds: [a], range });
    expect(stats.days).toEqual([
      expect.objectContaining({
        placeId: a,
        day: '2026-11-05',
        narrationsStarted: 2,
        listenMsSum: '0',
      }),
    ]);
    expect(stats.dataThrough).toBe('2026-11-06');

    const overview = await services.reads.overview({ range });
    expect(
      overview.days.map((day) => [day.day, day.narrationsStarted, day.geofenceStarted]),
    ).toEqual([
      ['2026-11-04', 0, 0],
      ['2026-11-05', 3, 3],
      ['2026-11-06', 0, 0],
    ]);
    expect(overview.languages).toEqual([
      { lang: 'en', narrationsStarted: 2, narrationsCompleted: 0 },
      { lang: 'vi', narrationsStarted: 1, narrationsCompleted: 0 },
    ]);

    const top = await services.reads.topPlaces({
      range,
      metric: analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_STARTED,
      limit: 1,
    });
    expect(top.places.map((place) => place.placeId)).toEqual([a]);
  });

  it('refuses a range over 93 days', async () => {
    expect(
      await codeOf(
        services.reads.overview({ range: { fromDay: '2026-08-01', toDay: '2026-11-02' } }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('the heatmap', () => {
  const inside = geohashOf(10.7605, 106.7035);
  const outside = geohashOf(10.8, 106.65);
  const box = { minLat: 10.755, minLng: 106.698, maxLat: 10.766, maxLng: 106.708 };

  async function row(cell: string, at: string, estimate: number): Promise<void> {
    await services.prisma.locationCellHourly.create({
      data: { cell, bucketStart: new Date(at), deviceEstimate: estimate },
    });
  }

  it('sums the band’s hours — 22:00–02:00 in Vietnam is 15:00–19:00 UTC — inside the box', async () => {
    await row(inside, '2026-11-05T15:00:00Z', 6); // 22:00 Vietnam
    await row(inside, '2026-11-05T18:00:00Z', 7); // 01:00 Vietnam, the next day
    await row(inside, '2026-11-05T03:00:00Z', 9); // 10:00 Vietnam: outside the band
    await row(outside, '2026-11-05T15:00:00Z', 20);
    const heat = await services.reads.heatmap({
      range,
      utcHours: [15, 16, 17, 18],
      ...box,
    });
    expect(heat.cells).toEqual([{ cell: inside, estimate: 13 }]);
    const allDay = await services.reads.heatmap({ range, utcHours: [], ...box });
    expect(allDay.cells).toEqual([{ cell: inside, estimate: 22 }]);
  });
});

describe('the runtime lane', () => {
  it('an Area’s finished hours, quiet ones as zero; this hour so far from the live counters', async () => {
    const area = newId();
    await services.prisma.runtimeActivityHourly.create({
      data: { areaId: area, bucketStart: new Date('2026-11-07T04:00:00Z'), activeEstimate: 12 },
    });
    const hours = await services.reads.runtimeActivity({ areaId: area, hours: 3 }, now);
    expect(hours.hours.map((hour) => hour.estimate)).toEqual([0, 0, 12]);
    // A week is the most one read covers: 168 hours answer 168, more answer a week.
    const week = await services.reads.runtimeActivity({ areaId: area, hours: 168 }, now);
    expect(week.hours).toHaveLength(168);
    expect(week.hours.at(-1)!.estimate).toBe(12);
    const more = await services.reads.runtimeActivity({ areaId: area, hours: 500 }, now);
    expect(more.hours).toHaveLength(168);
    await services.redis.pfadd(runtimeKey(area, now), 'x', 'y');
    const current = await services.reads.currentActivity({ areaIds: [area, newId()] }, now);
    expect(current.areas).toEqual([{ areaId: area, estimate: 2 }]);
  });
});
