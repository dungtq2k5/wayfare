// Consent and ingest (rdm-spec A-1 … A-3): append-only decisions; a withdrawal deletes the
// id's raw events and wins any race with a batch; the gate, duplicates, the clock's clamp, the
// whole-batch and the per-event refusals; a cell counted in its event's hour.
import {
  AnalyticsEventType,
  ConsentState,
  heatmapKey,
  HEATMAP_KEY_TTL_SECONDS,
  newId,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { analyticsServices } from '../setup/services';
import { codeOf, consenting, event, ingest, POLICY } from '../setup/fixtures';

const services = analyticsServices();
beforeEach(() => services.reset());
afterAll(() => services.close());

describe('consent', () => {
  it('appends every decision; the newest is the state', async () => {
    const id = await consenting(services);
    await services.events.recordConsent({
      analyticsDeviceId: id,
      state: ConsentState.WITHDRAWN,
      policyVersion: POLICY,
    });
    const rows = await services.prisma.consent.findMany({
      where: { analyticsDeviceId: id },
      orderBy: { recordedAt: 'asc' },
    });
    expect(rows.map((row) => row.state)).toEqual(['GRANTED', 'WITHDRAWN']);
    expect(await codeOf(ingest(services, id, [event()]))).toBe('CONSENT_REQUIRED');
  });

  it('refuses a grant on an outdated policy; accepts a withdrawal at any version, for any id', async () => {
    expect(
      await codeOf(
        services.events.recordConsent({
          analyticsDeviceId: newId(),
          state: ConsentState.GRANTED,
          policyVersion: '2020-01-01',
        }),
      ),
    ).toBe('LEGAL_VERSION_OUTDATED');
    const never = newId();
    await services.events.recordConsent({
      analyticsDeviceId: never,
      state: ConsentState.WITHDRAWN,
      policyVersion: '2020-01-01',
    });
    expect(await services.prisma.consent.count({ where: { analyticsDeviceId: never } })).toBe(1);
  });

  it('a withdrawal deletes the id’s raw events, and only its own', async () => {
    const [mine, other] = [await consenting(services), await consenting(services)];
    await ingest(services, mine, [event(), event()]);
    await ingest(services, other, [event()]);
    await services.events.recordConsent({
      analyticsDeviceId: mine,
      state: ConsentState.WITHDRAWN,
      policyVersion: POLICY,
    });
    expect(await services.prisma.event.count({ where: { analyticsDeviceId: mine } })).toBe(0);
    expect(await services.prisma.event.count({ where: { analyticsDeviceId: other } })).toBe(1);
  });

  it('a batch racing a withdrawal stores nothing', async () => {
    for (let round = 0; round < 10; round++) {
      const id = await consenting(services);
      const results = await Promise.allSettled([
        ingest(services, id, [event(), event(), event()]),
        services.events.recordConsent({
          analyticsDeviceId: id,
          state: ConsentState.WITHDRAWN,
          policyVersion: POLICY,
        }),
      ]);
      expect(results[1].status).toBe('fulfilled');
      expect(await services.prisma.event.count({ where: { analyticsDeviceId: id } })).toBe(0);
    }
  });

  it('after the next rebuild, the id is gone from the days still covered; older days stay', async () => {
    const now = new Date('2026-11-07T05:00:00Z');
    const place = newId();
    const id = await consenting(services, new Date('2026-10-01T00:00:00Z'));
    const keep = await consenting(services, new Date('2026-10-01T00:00:00Z'));
    const recent = new Date('2026-11-04T03:00:00Z'); // within the 8 days rebuilt
    const old = new Date('2026-10-20T03:00:00Z'); // before them
    for (const who of [id, keep]) {
      await services.prisma.event.createMany({
        data: [recent, old].map((occurredAt) => ({
          id: newId(),
          analyticsDeviceId: who,
          sessionId: newId(),
          eventType: AnalyticsEventType.NARRATION_STARTED,
          trigger: 'GEOFENCE',
          audioTier: 'T1',
          placeId: place,
          lang: 'en',
          platform: 'ANDROID',
          appVersion: '0.4.1',
          occurredAt,
        })),
      });
    }
    await services.dailyRollup.rebuildDay('2026-10-20', now);
    await services.dailyRollup.run(now);
    await services.events.recordConsent(
      { analyticsDeviceId: id, state: ConsentState.WITHDRAWN, policyVersion: POLICY },
      now,
    );
    await services.dailyRollup.run(now);
    const day = async (date: string) =>
      (
        await services.prisma.placeDailyStats.findUnique({
          where: { placeId_day: { placeId: place, day: new Date(`${date}T00:00:00Z`) } },
        })
      )?.narrationsStarted;
    expect(await day('2026-11-04')).toBe(1);
    expect(await day('2026-10-20')).toBe(2);
  });
});

describe('ingest', () => {
  it('is refused without a current grant', async () => {
    expect(await codeOf(ingest(services, newId(), [event()]))).toBe('CONSENT_REQUIRED');
  });

  it('drops duplicates by id, so a retried batch stores each event once', async () => {
    const id = await consenting(services);
    const batch = [event(), event()];
    expect(await ingest(services, id, batch)).toEqual({ stored: 2, duplicates: 0, dropped: 0 });
    expect(await ingest(services, id, batch)).toEqual({ stored: 0, duplicates: 2, dropped: 0 });
    expect(await services.prisma.event.count()).toBe(2);
  });

  it('clamps the clock to a week back and five minutes ahead', async () => {
    const id = await consenting(services);
    const now = new Date('2026-11-07T10:00:00Z');
    const [past, future] = [
      event({ occurredAt: '2025-01-01T00:00:00Z' }),
      event({ occurredAt: '2031-01-01T00:00:00Z' }),
    ];
    await ingest(services, id, [past, future], now);
    const at = async (sent: Record<string, unknown>) =>
      (await services.prisma.event.findUniqueOrThrow({ where: { id: sent.id as string } }))
        .occurredAt;
    expect(await at(past)).toEqual(new Date('2026-10-31T10:00:00Z'));
    expect(await at(future)).toEqual(new Date('2026-11-07T10:05:00Z'));
  });

  it('refuses the whole batch with a coordinate anywhere', async () => {
    const id = await consenting(services);
    expect(
      await codeOf(ingest(services, id, [event(), event({ props: { where: { lng: 106.7 } } })])),
    ).toBe('VALIDATION_FAILED');
    expect(await services.prisma.event.count()).toBe(0);
  });

  it('drops an event that fails its props, and a voucher view while vouchers aren’t sold', async () => {
    const id = await consenting(services);
    const result = await ingest(services, id, [
      event(),
      event({ type: AnalyticsEventType.SEARCH_PERFORMED, props: { query: 'ốc' } }),
      event({ type: AnalyticsEventType.VOUCHER_VIEWED }),
      event({ type: AnalyticsEventType.NARRATION_STARTED, placeId: newId() }),
      event({ type: AnalyticsEventType.SEARCH_PERFORMED, props: { resultCount: 3 } }),
    ]);
    expect(result).toEqual({ stored: 2, duplicates: 0, dropped: 3 });
  });

  it('adds the id to its cell’s counter for the event’s own hour, kept 8 days; no row stores the cell', async () => {
    const id = await consenting(services);
    const now = new Date('2026-11-07T10:20:00Z');
    const lateHour = new Date('2026-11-05T22:40:00Z');
    await ingest(
      services,
      id,
      [event({ cell: 'w3gv2cp', occurredAt: lateHour.toISOString() })],
      now,
    );
    const key = heatmapKey('w3gv2cp', lateHour);
    expect(await services.redis.pfcount(key)).toBe(1);
    const ttl = await services.redis.ttl(key);
    expect(ttl).toBeGreaterThan(HEATMAP_KEY_TTL_SECONDS - 60);
    const [row] = await services.prisma.$queryRaw<{ props: unknown }[]>`SELECT props FROM events`;
    expect(JSON.stringify(row)).not.toContain('w3gv2cp');
  });
});
