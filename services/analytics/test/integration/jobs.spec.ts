// The four jobs: the heatmap's late events and its floor of 5; the runtime lane's finished
// hours; whole days rebuilt — replaced, the tiers, the '*' totals and per-language rows,
// `dataThrough`, a day past retention refused; the 90- and 400-day prunes.
import { AnalyticsEventType, heatmapKey, newId, runtimeKey } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { analyticsServices } from '../setup/services';
import { consenting, event, ingest, started } from '../setup/fixtures';

const services = analyticsServices();
beforeEach(() => services.reset());
afterAll(() => services.close());

const DAY = new Date('2026-11-05T00:00:00Z');

/** Five phones in one cell-hour, as ingest would count them. */
async function phones(cell: string, hour: Date, count: number, offset = 0): Promise<void> {
  for (let index = 0; index < count; index++) {
    await services.redis.pfadd(heatmapKey(cell, hour), `phone-${offset + index}`);
  }
}

describe('heatmap-flush', () => {
  const hour = new Date('2026-11-06T13:00:00Z');

  it('writes a cell at 5 or more, never under; a re-run changes nothing', async () => {
    await phones('w3gv2cp', hour, 5);
    await phones('w3gv2cq', hour, 4);
    await services.heatmapFlush.run(new Date('2026-11-06T14:05:00Z'));
    const rows = await services.prisma.locationCellHourly.findMany();
    expect(rows.map((row) => [row.cell, row.deviceEstimate])).toEqual([['w3gv2cp', 5]]);
    await services.heatmapFlush.run(new Date('2026-11-06T15:05:00Z'));
    expect(
      (await services.prisma.locationCellHourly.findMany()).map((row) => row.deviceEstimate),
    ).toEqual([5]);
  });

  it('a late event lands in its own hour; a cell reaching 5 late is written then', async () => {
    await phones('w3gv2cq', hour, 4);
    await services.heatmapFlush.run(new Date('2026-11-06T14:05:00Z'));
    expect(await services.prisma.locationCellHourly.count()).toBe(0);
    // A phone offline that evening uploads two days later: the same hour's counter grows.
    const id = await consenting(services);
    await ingest(
      services,
      id,
      [event({ cell: 'w3gv2cq', occurredAt: '2026-11-06T13:30:00Z' })],
      new Date('2026-11-08T09:00:00Z'),
    );
    await services.heatmapFlush.run(new Date('2026-11-08T09:05:00Z'));
    const [row] = await services.prisma.locationCellHourly.findMany();
    expect(row).toMatchObject({ cell: 'w3gv2cq', bucketStart: hour, deviceEstimate: 5 });
  });
});

describe('runtime-flush', () => {
  it('writes each finished hour’s Area counter, never the hour in progress', async () => {
    const area = newId();
    const now = new Date('2026-11-07T10:05:00Z');
    const previous = new Date('2026-11-07T09:00:00Z');
    await services.redis.pfadd(runtimeKey(area, previous), 'a', 'b', 'c');
    await services.redis.pfadd(runtimeKey(area, now), 'd');
    await services.runtimeFlush.run(now);
    const rows = await services.prisma.runtimeActivityHourly.findMany();
    expect(rows.map((row) => [row.bucketStart.toISOString(), row.activeEstimate])).toEqual([
      ['2026-11-07T09:00:00.000Z', 3],
    ]);
  });
});

describe('daily-rollup', () => {
  const now = new Date('2026-11-07T05:00:00Z');
  const place = newId();

  async function day(): Promise<void> {
    const [a, b] = [await consenting(services), await consenting(services)];
    const at = new Date('2026-11-05T03:00:00Z'); // 10:00 in Vietnam
    await ingest(
      services,
      a,
      [
        event({ type: AnalyticsEventType.APP_OPENED, occurredAt: at.toISOString() }),
        started(place, at),
        started(place, at, { trigger: 'TAP', audioTier: 'T3', lang: 'ko' }),
        event({
          type: AnalyticsEventType.NARRATION_COMPLETED,
          placeId: place,
          lang: 'en',
          listenMs: 120_000,
          occurredAt: at.toISOString(),
        }),
        event({
          type: AnalyticsEventType.PLACE_OPENED,
          placeId: place,
          occurredAt: at.toISOString(),
        }),
      ],
      at,
    );
    await ingest(
      services,
      b,
      [
        event({ type: AnalyticsEventType.APP_OPENED, occurredAt: at.toISOString() }),
        started(place, at, { trigger: 'QR', audioTier: 'T1_5' }),
        event({
          type: AnalyticsEventType.NARRATION_ABANDONED,
          placeId: place,
          lang: 'en',
          listenMs: 30_000,
          occurredAt: at.toISOString(),
        }),
        event({
          type: AnalyticsEventType.PACK_INSTALLED,
          props: { areaId: newId() },
          occurredAt: at.toISOString(),
        }),
      ],
      at,
      'WEB',
    );
  }

  it('rebuilds a day into A-4 and A-6: the triggers, the tiers, the totals and language rows', async () => {
    await day();
    await services.dailyRollup.rebuildDay('2026-11-05', now);
    const placeDay = await services.prisma.placeDailyStats.findUniqueOrThrow({
      where: { placeId_day: { placeId: place, day: DAY } },
    });
    expect(placeDay).toMatchObject({
      narrationsStarted: 3,
      narrationsCompleted: 1,
      narrationsAbandoned: 1,
      geofenceStarted: 1,
      tapStarted: 1,
      qrStarted: 1,
      listenMsSum: 150_000n,
      listenCount: 2,
      opens: 1,
    });
    const rows = await services.prisma.activityDailyStats.findMany({
      where: { day: DAY },
      orderBy: [{ lang: 'asc' }, { platform: 'asc' }],
    });
    const pick = (lang: string, platform: string) =>
      rows.find((row) => row.lang === lang && row.platform === platform);
    expect(pick('*', 'ANDROID')).toMatchObject({
      sessions: 1,
      activeDevicesEstimate: 1,
      narrationsStarted: 2,
      narrationsCompleted: 1,
      tier1Narrations: 1,
      tier3Narrations: 1,
    });
    expect(pick('*', 'WEB')).toMatchObject({ sessions: 1, packInstalls: 1, tier15Narrations: 1 });
    expect(pick('ko', 'ANDROID')).toMatchObject({
      narrationsStarted: 1,
      sessions: 0,
      tier3Narrations: 1,
    });
    expect(pick('en', 'ANDROID')).toMatchObject({ narrationsStarted: 1, narrationsCompleted: 1 });
    expect(await services.reads.dataThrough()).toBe('2026-11-05');
  });

  it('replaces a rebuilt day, never adds to it; a late event within the week lands in its day', async () => {
    await day();
    await services.dailyRollup.run(now);
    await services.dailyRollup.run(now);
    const before = await services.prisma.placeDailyStats.findUniqueOrThrow({
      where: { placeId_day: { placeId: place, day: DAY } },
    });
    expect(before.narrationsStarted).toBe(3);
    const late = await consenting(services);
    await ingest(services, late, [started(place, new Date('2026-11-05T04:00:00Z'))], now);
    await services.dailyRollup.run(now);
    const after = await services.prisma.placeDailyStats.findUniqueOrThrow({
      where: { placeId_day: { placeId: place, day: DAY } },
    });
    expect(after.narrationsStarted).toBe(4);
    expect(await services.reads.dataThrough()).toBe('2026-11-06');
  });

  it('refuses a day past the raw events’ 90 days, and today', async () => {
    await expect(services.dailyRollup.rebuildDay('2026-07-01', now)).rejects.toThrow(
      /can't be rebuilt/,
    );
    await expect(services.dailyRollup.rebuildDay('2026-11-07', now)).rejects.toThrow(
      /can't be rebuilt/,
    );
  });
});

describe('raw-prune', () => {
  it('deletes events older than 90 days, and an id’s consents 400 days after its newest', async () => {
    const now = new Date('2026-11-07T00:00:00Z');
    const fresh = await consenting(services, new Date('2026-11-01T00:00:00Z'));
    const stale = await consenting(services, new Date('2025-09-01T00:00:00Z'));
    const base = {
      analyticsDeviceId: fresh,
      sessionId: newId(),
      eventType: 'APP_OPENED',
      platform: 'ANDROID',
      appVersion: '0.4.1',
    };
    await services.prisma.event.createMany({
      data: [
        { ...base, id: newId(), occurredAt: new Date('2026-08-01T00:00:00Z') },
        { ...base, id: newId(), occurredAt: new Date('2026-08-10T00:00:00Z') },
      ],
    });
    expect(await services.rawPrune.run(now)).toEqual({ events: 1, consents: 1 });
    expect(await services.prisma.consent.count({ where: { analyticsDeviceId: stale } })).toBe(0);
    expect(await services.prisma.consent.count({ where: { analyticsDeviceId: fresh } })).toBe(1);
  });
});
