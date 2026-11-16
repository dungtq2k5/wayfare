import { Inject, Injectable } from '@nestjs/common';
import {
  businessDayStart,
  businessDaysBetween,
  geohashCentre,
  hourStart,
  nextBusinessDay,
  RUNTIME_HOURS_MAX,
  runtimeKey,
  zAnalyticsRange,
} from '@wayfare/contracts';
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { rpcError, toProtoTimestamp } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

const HOUR_MS = 60 * 60 * 1000;

/** A `DATE` column's value as the business day it holds. */
const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** The range, checked as the gateway checked it: business days, at most 93 (api-endpoints-plan §7). */
function rangeOf(range: analyticsGrpc.DayRange | undefined): { from: string; to: string } {
  const parsed = zAnalyticsRange.safeParse({ from: range?.fromDay, to: range?.toDay });
  if (!parsed.success)
    throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/range', code: 'invalid' }] });
  return parsed.data;
}

const ZERO_DAY = {
  sessions: 0,
  activeDevicesEstimate: 0,
  packInstalls: 0,
  searches: 0,
  narrationsStarted: 0,
  narrationsCompleted: 0,
  geofenceStarted: 0,
  tapStarted: 0,
  qrStarted: 0,
  tier1Narrations: 0,
  tier15Narrations: 0,
  tier2Narrations: 0,
  tier3Narrations: 0,
};

/** The dashboards' reads (api-endpoints-plan §7): rollups as they are; the gateway composes. */
@Injectable()
export class ReadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The last business day the nightly rollup completed; undefined before its first run. */
  async dataThrough(): Promise<string | undefined> {
    const newest = await this.prisma.rollupDay.findFirst({
      orderBy: { day: 'desc' },
      select: { day: true },
    });
    return newest === null ? undefined : dayOf(newest.day);
  }

  async placeDailyStats(
    request: analyticsGrpc.GetPlaceDailyStatsRequest,
  ): Promise<analyticsGrpc.GetPlaceDailyStatsResponse> {
    const { from, to } = rangeOf(request.range);
    const rows =
      request.placeIds.length === 0
        ? []
        : await this.prisma.placeDailyStats.findMany({
            where: {
              placeId: { in: request.placeIds },
              day: { gte: dateOf(from), lte: dateOf(to) },
            },
            orderBy: [{ day: 'asc' }, { placeId: 'asc' }],
          });
    return {
      days: rows.map((row) => ({
        placeId: row.placeId,
        day: dayOf(row.day),
        narrationsStarted: row.narrationsStarted,
        narrationsCompleted: row.narrationsCompleted,
        narrationsAbandoned: row.narrationsAbandoned,
        geofenceStarted: row.geofenceStarted,
        tapStarted: row.tapStarted,
        qrStarted: row.qrStarted,
        listenMsSum: row.listenMsSum.toString(),
        listenCount: row.listenCount,
        opens: row.opens,
      })),
      dataThrough: await this.dataThrough(),
    };
  }

  /** Every day of the range — quiet ones as zeros — and the languages over the whole range. */
  async overview(
    request: analyticsGrpc.GetOverviewRequest,
  ): Promise<analyticsGrpc.GetOverviewResponse> {
    const { from, to } = rangeOf(request.range);
    const where = { day: { gte: dateOf(from), lte: dateOf(to) } };
    const [totals, triggers, languages] = await Promise.all([
      this.prisma.activityDailyStats.groupBy({
        by: ['day'],
        where: { ...where, lang: '*' },
        _sum: {
          sessions: true,
          activeDevicesEstimate: true,
          packInstalls: true,
          searches: true,
          narrationsStarted: true,
          narrationsCompleted: true,
          tier1Narrations: true,
          tier15Narrations: true,
          tier2Narrations: true,
          tier3Narrations: true,
        },
      }),
      this.prisma.placeDailyStats.groupBy({
        by: ['day'],
        where,
        _sum: { geofenceStarted: true, tapStarted: true, qrStarted: true },
      }),
      this.prisma.activityDailyStats.groupBy({
        by: ['lang'],
        where: { ...where, lang: { not: '*' } },
        _sum: { narrationsStarted: true, narrationsCompleted: true },
      }),
    ]);
    const byDay = new Map(totals.map((row) => [dayOf(row.day), row._sum]));
    const triggersByDay = new Map(triggers.map((row) => [dayOf(row.day), row._sum]));
    return {
      days: businessDaysBetween(from, to).map((day) => {
        const sum = byDay.get(day);
        const trigger = triggersByDay.get(day);
        return {
          ...ZERO_DAY,
          day,
          sessions: sum?.sessions ?? 0,
          activeDevicesEstimate: sum?.activeDevicesEstimate ?? 0,
          packInstalls: sum?.packInstalls ?? 0,
          searches: sum?.searches ?? 0,
          narrationsStarted: sum?.narrationsStarted ?? 0,
          narrationsCompleted: sum?.narrationsCompleted ?? 0,
          geofenceStarted: trigger?.geofenceStarted ?? 0,
          tapStarted: trigger?.tapStarted ?? 0,
          qrStarted: trigger?.qrStarted ?? 0,
          tier1Narrations: sum?.tier1Narrations ?? 0,
          tier15Narrations: sum?.tier15Narrations ?? 0,
          tier2Narrations: sum?.tier2Narrations ?? 0,
          tier3Narrations: sum?.tier3Narrations ?? 0,
        };
      }),
      languages: languages
        .map((row) => ({
          lang: row.lang,
          narrationsStarted: row._sum.narrationsStarted ?? 0,
          narrationsCompleted: row._sum.narrationsCompleted ?? 0,
        }))
        .toSorted(
          (a, b) => b.narrationsStarted - a.narrationsStarted || (a.lang < b.lang ? -1 : 1),
        ),
      dataThrough: await this.dataThrough(),
    };
  }

  async topPlaces(
    request: analyticsGrpc.GetTopPlacesRequest,
  ): Promise<analyticsGrpc.GetTopPlacesResponse> {
    const { from, to } = rangeOf(request.range);
    const limit = Math.min(Math.max(request.limit, 1), 100);
    const order =
      request.metric === analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_STARTED
        ? 'narrationsStarted'
        : request.metric === analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_LISTEN_MS
          ? 'listenMsSum'
          : 'narrationsCompleted';
    const rows = await this.prisma.placeDailyStats.groupBy({
      by: ['placeId'],
      where: { day: { gte: dateOf(from), lte: dateOf(to) } },
      _sum: { narrationsStarted: true, narrationsCompleted: true, listenMsSum: true },
      orderBy: [{ _sum: { [order]: 'desc' } }, { placeId: 'asc' }],
      take: limit,
    });
    return {
      places: rows.map((row) => ({
        placeId: row.placeId,
        narrationsStarted: row._sum.narrationsStarted ?? 0,
        narrationsCompleted: row._sum.narrationsCompleted ?? 0,
        listenMsSum: (row._sum.listenMsSum ?? 0n).toString(),
      })),
      dataThrough: await this.dataThrough(),
    };
  }

  /** A-3 summed per cell over the range's days and the UTC hours asked, inside the box. */
  async heatmap(
    request: analyticsGrpc.GetHeatmapRequest,
  ): Promise<analyticsGrpc.GetHeatmapResponse> {
    const { from, to } = rangeOf(request.range);
    const hours = request.utcHours.filter((hour) => hour >= 0 && hour < 24);
    const all = hours.length === 0;
    const rows = await this.prisma.$queryRaw<{ cell: string; estimate: bigint; computed: Date }[]>`
      SELECT cell, sum(device_estimate) AS estimate, max(computed_at) AS computed
      FROM location_cell_hourly
      WHERE bucket_start >= ${businessDayStart(from)}
        AND bucket_start < ${businessDayStart(nextBusinessDay(to))}
        AND (${all} OR extract(hour FROM bucket_start AT TIME ZONE 'UTC')::int = ANY(${hours}::int[]))
      GROUP BY cell`;
    const inside = rows.filter(({ cell }) => {
      const { lat, lng } = geohashCentre(cell);
      return (
        lat >= request.minLat &&
        lat <= request.maxLat &&
        lng >= request.minLng &&
        lng <= request.maxLng
      );
    });
    const newest = inside.reduce<Date | null>(
      (latest, row) => (latest === null || row.computed > latest ? row.computed : latest),
      null,
    );
    return {
      cells: inside
        .map((row) => ({ cell: row.cell, estimate: Number(row.estimate) }))
        .toSorted((a, b) => b.estimate - a.estimate || (a.cell < b.cell ? -1 : 1)),
      computedThrough: newest === null ? undefined : toProtoTimestamp(newest),
    };
  }

  /** The finished hours before this one, oldest first, a quiet hour as zero. */
  async runtimeActivity(
    request: analyticsGrpc.GetRuntimeActivityRequest,
    now: Date = new Date(),
  ): Promise<analyticsGrpc.GetRuntimeActivityResponse> {
    const count = Math.min(Math.max(request.hours, 1), RUNTIME_HOURS_MAX);
    const end = hourStart(now).getTime();
    const start = new Date(end - count * HOUR_MS);
    const rows = await this.prisma.runtimeActivityHourly.findMany({
      where: { areaId: request.areaId, bucketStart: { gte: start, lt: new Date(end) } },
      select: { bucketStart: true, activeEstimate: true },
    });
    const byHour = new Map(rows.map((row) => [row.bucketStart.getTime(), row.activeEstimate]));
    return {
      hours: Array.from({ length: count }, (_, index) => {
        const at = start.getTime() + index * HOUR_MS;
        return { hourStart: toProtoTimestamp(new Date(at)), estimate: byHour.get(at) ?? 0 };
      }),
    };
  }

  /** This hour so far per Area, from the gateway's live counters — not yet in A-5. */
  async currentActivity(
    request: analyticsGrpc.GetCurrentActivityRequest,
    now: Date = new Date(),
  ): Promise<analyticsGrpc.GetCurrentActivityResponse> {
    const counts = await Promise.all(
      request.areaIds.map(async (areaId) => ({
        areaId,
        estimate: await this.redis.pfcount(runtimeKey(areaId, now)),
      })),
    );
    return {
      hourStart: toProtoTimestamp(hourStart(now)),
      areas: counts
        .filter((area) => area.estimate > 0)
        .toSorted((a, b) => b.estimate - a.estimate || (a.areaId < b.areaId ? -1 : 1)),
    };
  }
}
