import { Injectable } from '@nestjs/common';
import {
  AnalyticsLevel,
  businessDaysBetween,
  compareStrings,
  PlaceStatus,
} from '@wayfare/contracts';
import { analyticsLevelProto, placeStatusProto } from '@wayfare/contracts/grpc';
import type { analyticsGrpc, catalogGrpc } from '@wayfare/contracts/grpc';
import { AppHttpException, fromProtoTimestamp } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { AnalyticsServiceGrpcClient } from '../analytics-client/analytics-service-grpc.client';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { z } from 'zod';
import type {
  ownerStatsDaySchema,
  ownerStatsFiguresSchema,
  OwnerStatsResponseDto,
  OwnerVenueStatsResponseDto,
} from './dto/owner-stats-response.dto';

/** The depths with numbers: `NONE` is refused before anything is read. */
type StatsLevel = 'BASIC' | 'FULL';

type Figures = z.output<typeof ownerStatsFiguresSchema>;
type Day = z.output<typeof ownerStatsDaySchema>;

/** What one Venue-day sums to, before the level decides what's shown. */
interface Sums {
  started: number;
  completed: number;
  abandoned: number;
  geofence: number;
  tap: number;
  qr: number;
  listenMs: number;
  listenCount: number;
  opens: number;
  scans: number;
}

const zero = (): Sums => ({
  started: 0,
  completed: 0,
  abandoned: 0,
  geofence: 0,
  tap: 0,
  qr: 0,
  listenMs: 0,
  listenCount: 0,
  opens: 0,
  scans: 0,
});

function add(into: Sums, row: analyticsGrpc.PlaceDay): void {
  into.started += row.narrationsStarted;
  into.completed += row.narrationsCompleted;
  into.abandoned += row.narrationsAbandoned;
  into.geofence += row.geofenceStarted;
  into.tap += row.tapStarted;
  into.qr += row.qrStarted;
  into.listenMs += Number(row.listenMsSum);
  into.listenCount += row.listenCount;
  into.opens += row.opens;
}

/** The figures a level shows: beyond it, absent — never 0 (api-endpoints-plan §7). */
function figuresAt(level: StatsLevel, sums: Sums): Figures {
  const basic = {
    narrationsStarted: sums.started,
    narrationsCompleted: sums.completed,
    completionRate: sums.started === 0 ? null : sums.completed / sums.started,
    averageListenMs: sums.listenCount === 0 ? null : Math.round(sums.listenMs / sums.listenCount),
    qrScans: sums.scans,
  };
  if (level === 'BASIC') return basic;
  return {
    ...basic,
    narrationsAbandoned: sums.abandoned,
    opens: sums.opens,
    startedBy: { walkingBy: sums.geofence, tapping: sums.tap, scanning: sums.qr },
  };
}

function dayAt(level: StatsLevel, day: string, sums: Sums): Day {
  return level === 'BASIC'
    ? { day, narrationsStarted: sums.started }
    : {
        day,
        narrationsStarted: sums.started,
        startedBy: { walkingBy: sums.geofence, tapping: sums.tap, scanning: sums.qr },
      };
}

/** Every Venue's sums per day of the range, from analytics' A-4 rows and catalog's C-15 scans. */
interface StatsGrid {
  /** The range's days, oldest first. */
  readonly days: readonly string[];
  /** One Venue's sums on one day; zeros for a quiet one. */
  at(placeId: string, day: string): Sums;
  /** The sums over the range, for the Venues given. */
  total(placeIds: readonly string[]): Sums;
  /** Each day's sums over the Venues given, at the level. */
  series(level: StatsLevel, placeIds: readonly string[]): Day[];
}

/** The grid for `from`…`to`. */
function statsGrid(
  from: string,
  to: string,
  rows: readonly analyticsGrpc.PlaceDay[],
  scans: readonly catalogGrpc.QrScanDay[],
): StatsGrid {
  const days = businessDaysBetween(from, to);
  const cells = new Map<string, Sums>();
  const cell = (placeId: string, day: string): Sums => {
    const key = `${placeId}|${day}`;
    let sums = cells.get(key);
    if (sums === undefined) {
      sums = zero();
      cells.set(key, sums);
    }
    return sums;
  };
  for (const row of rows) add(cell(row.placeId, row.day), row);
  for (const scan of scans) cell(scan.placeId, scan.day).scans += scan.scans;
  const at = (placeId: string, day: string): Sums => cells.get(`${placeId}|${day}`) ?? zero();
  return {
    days,
    at,
    total: (placeIds) => {
      const sums = zero();
      for (const day of days) for (const id of placeIds) merge(sums, at(id, day));
      return sums;
    },
    series: (level, placeIds) =>
      days.map((day) => {
        const sums = zero();
        for (const id of placeIds) merge(sums, at(id, day));
        return dayAt(level, day, sums);
      }),
  };
}

function merge(into: Sums, from: Sums): void {
  for (const key of Object.keys(into) as (keyof Sums)[]) into[key] += from[key];
}

/** The export's two header rows; the designer may reword them in the dashboards' round. */
const EXPORT_HEADERS = {
  en: [
    'Day',
    'Venue',
    'Narrations started',
    'Finished',
    'Stopped early',
    'Started by walking by',
    'Started by tapping',
    'Started by scanning',
    'Average listening (s)',
    'Page opens',
    'QR scans',
  ],
  vi: [
    'Ngày',
    'Địa điểm',
    'Lượt thuyết minh',
    'Nghe hết',
    'Dừng giữa chừng',
    'Bắt đầu khi đi ngang',
    'Bắt đầu khi chạm',
    'Bắt đầu khi quét mã',
    'Thời gian nghe trung bình (giây)',
    'Lượt mở trang',
    'Lượt quét mã QR',
  ],
} as const;

/** A CSV field, quoted when it must be (RFC 4180). */
const field = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * The export: UTF-8 with a BOM, so Excel reads Vietnamese; one row per Venue per day, every
 * day present — a quiet day is a true zero at `FULL`.
 */
function exportCsv(
  grid: StatsGrid,
  venues: readonly { placeId: string; name: string }[],
  lang: keyof typeof EXPORT_HEADERS,
): string {
  const lines = [EXPORT_HEADERS[lang].map(field).join(',')];
  for (const day of grid.days) {
    for (const venue of venues) {
      const sums = grid.at(venue.placeId, day);
      lines.push(
        [
          day,
          venue.name,
          sums.started,
          sums.completed,
          sums.abandoned,
          sums.geofence,
          sums.tap,
          sums.qr,
          sums.listenCount === 0 ? '' : Math.round(sums.listenMs / sums.listenCount / 1000),
          sums.opens,
          sums.scans,
        ]
          .map(field)
          .join(','),
      );
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** A Venue as the stats name it. */
interface Venue {
  readonly placeId: string;
  readonly name: string;
  readonly status: PlaceStatus;
  readonly categoryCode: string;
  readonly areaCode: string;
  readonly liveSince: string | null;
}

/** A range of business days. */
interface Range {
  readonly from: string;
  readonly to: string;
}

/**
 * `/owner/stats` (api-endpoints-plan §7), composed here: the Venues the owner owns now (catalog,
 * active or inactive, never deleted), their A-4 rows (analytics), their QR scans (catalog's C-15),
 * at the depth of the owner's plan (billing).
 */
@Injectable()
export class OwnerStatsService {
  constructor(
    private readonly analytics: AnalyticsServiceGrpcClient,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly billing: BillingServiceGrpcClient,
  ) {}

  async places(context: AccountContext, range: Range): Promise<OwnerStatsResponseDto> {
    const [level, venues] = await Promise.all([this.level(context), this.venues(context)]);
    const { grid, dataThrough } = await this.grid(context, range, venues);
    const ids = venues.map((venue) => venue.placeId);
    return {
      analyticsLevel: level,
      from: range.from,
      to: range.to,
      dataThrough,
      totals: figuresAt(level, grid.total(ids)),
      days: grid.series(level, ids),
      venues: venues.map((venue) => ({
        ...venue,
        totals: figuresAt(level, grid.total([venue.placeId])),
      })),
    };
  }

  /** One Venue's stats; another owner's — or a deleted one — is not found. */
  async place(
    context: AccountContext,
    placeId: string,
    range: Range,
  ): Promise<OwnerVenueStatsResponseDto> {
    const [level, venues] = await Promise.all([this.level(context), this.venues(context)]);
    const venue = venues.find((candidate) => candidate.placeId === placeId);
    if (venue === undefined)
      throw new AppHttpException('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    const { grid, dataThrough } = await this.grid(context, range, [venue]);
    return {
      analyticsLevel: level,
      from: range.from,
      to: range.to,
      dataThrough,
      venue,
      totals: figuresAt(level, grid.total([placeId])),
      days: grid.series(level, [placeId]),
    };
  }

  /** The CSV: `FULL` only. */
  async export(
    context: AccountContext,
    range: Range & { lang: 'en' | 'vi' },
  ): Promise<{ csv: string; filename: string }> {
    const [level, venues] = await Promise.all([this.level(context), this.venues(context)]);
    if (level !== 'FULL') throw new AppHttpException('ANALYTICS_LEVEL_INSUFFICIENT');
    const { grid } = await this.grid(context, range, venues);
    return {
      csv: exportCsv(grid, venues, range.lang),
      filename: `wayfare-stats-${range.from}-${range.to}.csv`,
    };
  }

  /** The plan's depth; `NONE` — or an unknown level — has no numbers. */
  private async level(context: AccountContext): Promise<StatsLevel> {
    const { entitlements } = await this.billing.entitlements.call(
      'getEntitlements',
      { ownerUserId: context.userId },
      context,
    );
    const level = analyticsLevelProto.fromProto(entitlements?.analyticsLevel);
    if (level === AnalyticsLevel.BASIC) return 'BASIC';
    if (level === AnalyticsLevel.FULL) return 'FULL';
    throw new AppHttpException('ANALYTICS_LEVEL_INSUFFICIENT');
  }

  /** The Venues the owner owns now, by name. */
  private async venues(context: AccountContext): Promise<Venue[]> {
    const { places } = await this.catalog.ownerPlaces.call('listMyPlaces', {}, context);
    return places
      .map((place) => {
        const status = placeStatusProto.fromProto(place.status) ?? PlaceStatus.INACTIVE;
        return {
          placeId: place.id,
          name: place.nameVi,
          status,
          categoryCode: place.categoryCode,
          areaCode: place.areaCode,
          liveSince:
            status === PlaceStatus.ACTIVE && place.statusChangedAt !== undefined
              ? fromProtoTimestamp(place.statusChangedAt, 'statusChangedAt').toISOString()
              : null,
        };
      })
      .toSorted((a, b) => compareStrings(a.name, b.name) || compareStrings(a.placeId, b.placeId));
  }

  private async grid(
    context: AccountContext,
    range: Range,
    venues: readonly Venue[],
  ): Promise<{ grid: StatsGrid; dataThrough: string | null }> {
    const placeIds = venues.map((venue) => venue.placeId);
    if (placeIds.length === 0) {
      const { dataThrough } = await this.analytics.reads.call(
        'getPlaceDailyStats',
        { placeIds: [], range: { fromDay: range.from, toDay: range.to } },
        context,
      );
      return { grid: statsGrid(range.from, range.to, [], []), dataThrough: dataThrough ?? null };
    }
    const [stats, scans] = await Promise.all([
      this.analytics.reads.call(
        'getPlaceDailyStats',
        { placeIds, range: { fromDay: range.from, toDay: range.to } },
        context,
      ),
      this.catalog.insights.call(
        'getQrScans',
        { placeIds, fromDay: range.from, toDay: range.to },
        context,
      ),
    ]);
    return {
      grid: statsGrid(range.from, range.to, stats.days, scans.days),
      dataThrough: stats.dataThrough ?? null,
    };
  }
}
