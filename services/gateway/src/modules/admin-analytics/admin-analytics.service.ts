import { Injectable } from '@nestjs/common';
import { geohashBounds, geohashCentre, PlaceStatus, utcHoursOfBand } from '@wayfare/contracts';
import { analyticsGrpc, placeStatusProto } from '@wayfare/contracts/grpc';
import { AppHttpException, fromProtoTimestamp } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { AnalyticsServiceGrpcClient } from '../analytics-client/analytics-service-grpc.client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type {
  AdminAnalyticsOverviewResponseDto,
  AdminHeatmapResponseDto,
  AdminRuntimeResponseDto,
  AdminTopPlacesResponseDto,
} from './dto/admin-analytics-response.dto';

/** What the top Places rank by, as the route names it. */
type TopMetric = 'completed' | 'started' | 'listenMs';

/** The route's metric as the RPC's. */
const TOP_METRIC_PROTO: Readonly<Record<TopMetric, analyticsGrpc.TopPlacesMetric>> = {
  completed: analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_COMPLETED,
  started: analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_STARTED,
  listenMs: analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_LISTEN_MS,
};

/** An Area's bounding box, from its boundary as catalog serves it (GeoJSON). */
function boundsOf(boundaryGeojson: string): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} {
  const geometry = JSON.parse(boundaryGeojson) as { coordinates: unknown };
  const points: [number, number][] = [];
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[0], value[1]]);
      return;
    }
    for (const inner of value) walk(inner);
  };
  walk(geometry.coordinates);
  return {
    minLng: Math.min(...points.map(([lng]) => lng)),
    maxLng: Math.max(...points.map(([lng]) => lng)),
    minLat: Math.min(...points.map(([, lat]) => lat)),
    maxLat: Math.max(...points.map(([, lat]) => lat)),
  };
}

/** A cell as a GeoJSON square, drawn as stored — never a blurred glow (handoff's heatmap). */
function cellFeature(cell: string, estimate: number, label?: string | null) {
  const { minLat, minLng, maxLat, maxLng } = geohashBounds(cell);
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ] as [number, number][],
      ],
    },
    properties: { cell, estimate, ...(label === undefined ? {} : { label }) },
  };
}

/** The points to label: each cell's centre. */
const centresOf = (cells: readonly string[]) => cells.map((cell) => geohashCentre(cell));

/** How many of the busiest squares carry a label, and how far a label looks. */
const LABELLED_SQUARES = 10;
const LABEL_RADIUS_M = 300;

interface Range {
  readonly from: string;
  readonly to: string;
}

/**
 * `/admin/analytics` (api-endpoints-plan §7): analytics' rollups, with what catalog knows — QR
 * scans, Place names, Area bounds and the heatmap's labels.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly analytics: AnalyticsServiceGrpcClient,
    private readonly catalog: CatalogServiceGrpcClient,
  ) {}

  async overview(
    context: AccountContext,
    range: Range,
  ): Promise<AdminAnalyticsOverviewResponseDto> {
    const [overview, scans] = await Promise.all([
      this.analytics.reads.call(
        'getOverview',
        { range: { fromDay: range.from, toDay: range.to } },
        context,
      ),
      this.catalog.insights.call(
        'getQrScans',
        { placeIds: [], fromDay: range.from, toDay: range.to },
        context,
      ),
    ]);
    const scansByDay = new Map(scans.days.map((day) => [day.day, day.scans]));
    const days = overview.days.map((day) => ({
      day: day.day,
      sessions: day.sessions,
      narrationsStarted: day.narrationsStarted,
      narrationsCompleted: day.narrationsCompleted,
      byTrigger: {
        walkingBy: day.geofenceStarted,
        tapping: day.tapStarted,
        scanning: day.qrStarted,
      },
      byTier: {
        t1: day.tier1Narrations,
        t1_5: day.tier15Narrations,
        t2: day.tier2Narrations,
        t3: day.tier3Narrations,
      },
      packInstalls: day.packInstalls,
      qrScans: scansByDay.get(day.day) ?? 0,
      activeDevicesEstimate: day.activeDevicesEstimate,
    }));
    const sum = (pick: (day: (typeof days)[number]) => number) =>
      days.reduce((total, day) => total + pick(day), 0);
    const started = sum((day) => day.narrationsStarted);
    const completed = sum((day) => day.narrationsCompleted);
    return {
      from: range.from,
      to: range.to,
      dataThrough: overview.dataThrough ?? null,
      totals: {
        sessions: sum((day) => day.sessions),
        narrationsStarted: started,
        narrationsCompleted: completed,
        completionRate: started === 0 ? null : completed / started,
        byTrigger: {
          walkingBy: sum((day) => day.byTrigger.walkingBy),
          tapping: sum((day) => day.byTrigger.tapping),
          scanning: sum((day) => day.byTrigger.scanning),
        },
        byTier: {
          t1: sum((day) => day.byTier.t1),
          t1_5: sum((day) => day.byTier.t1_5),
          t2: sum((day) => day.byTier.t2),
          t3: sum((day) => day.byTier.t3),
        },
        packInstalls: sum((day) => day.packInstalls),
        qrScans: sum((day) => day.qrScans),
        activeDevicesEstimate:
          days.length === 0 ? 0 : Math.round(sum((day) => day.activeDevicesEstimate) / days.length),
      },
      days,
      languages: overview.languages,
    };
  }

  /**
   * The top Places by a metric: twice `limit` asked of analytics, the ones catalog no longer
   * returns (deleted) dropped, `limit` kept.
   */
  async topPlaces(
    context: AccountContext,
    query: Range & { metric: TopMetric; limit: number },
  ): Promise<AdminTopPlacesResponseDto> {
    const top = await this.analytics.reads.call(
      'getTopPlaces',
      {
        range: { fromDay: query.from, toDay: query.to },
        metric: TOP_METRIC_PROTO[query.metric],
        limit: query.limit * 2,
      },
      context,
    );
    const { places } =
      top.places.length === 0
        ? { places: [] }
        : await this.catalog.places.call(
            'batchGetPlaceSummaries',
            { placeIds: top.places.map((place) => place.placeId) },
            context,
          );
    const named = new Map(places.map((place) => [place.id, place]));
    return {
      metric: query.metric,
      dataThrough: top.dataThrough ?? null,
      places: top.places
        .flatMap((place) => {
          const summary = named.get(place.placeId);
          if (summary === undefined) return [];
          return [
            {
              placeId: place.placeId,
              name: summary.nameVi,
              status: placeStatusProto.fromProto(summary.status) ?? PlaceStatus.INACTIVE,
              narrationsStarted: place.narrationsStarted,
              narrationsCompleted: place.narrationsCompleted,
              listenMs: Number(place.listenMsSum),
            },
          ];
        })
        .slice(0, query.limit),
    };
  }

  /**
   * The heatmap of a live Area: A-3 summed over the days and the hour band (Vietnam time, converted
   * to UTC), squares under 5 absent; the ten busiest labelled with the nearest live Place.
   */
  async heatmap(
    context: AccountContext,
    query: Range & { areaId: string; hours: [number, number] },
  ): Promise<AdminHeatmapResponseDto> {
    const { areas } = await this.catalog.placeQueries.call('listAreas', {}, context);
    const area = areas.find((candidate) => candidate.id === query.areaId);
    if (area === undefined) throw new AppHttpException('RESOURCE_NOT_FOUND', { resource: 'AREA' });
    const band = query.hours[0] === 0 && query.hours[1] === 24 ? [] : utcHoursOfBand(query.hours);
    const heat = await this.analytics.reads.call(
      'getHeatmap',
      {
        range: { fromDay: query.from, toDay: query.to },
        utcHours: band,
        ...boundsOf(area.boundaryGeojson),
      },
      context,
    );
    const busiest = heat.cells.slice(0, LABELLED_SQUARES);
    const { places } =
      busiest.length === 0
        ? { places: [] }
        : await this.catalog.insights.call(
            'nearestLivePlaces',
            { points: centresOf(busiest.map((cell) => cell.cell)), radiusM: LABEL_RADIUS_M },
            context,
          );
    const labels = new Map(places.map((place) => [place.index, place.nameVi]));
    return {
      areaId: area.id,
      from: query.from,
      to: query.to,
      hours: `${query.hours[0]}-${query.hours[1]}`,
      computedThrough:
        heat.computedThrough === undefined
          ? null
          : fromProtoTimestamp(heat.computedThrough, 'computedThrough').toISOString(),
      cells: {
        type: 'FeatureCollection',
        features: heat.cells.map((cell, index) =>
          index < LABELLED_SQUARES
            ? cellFeature(cell.cell, cell.estimate, labels.get(index) ?? null)
            : cellFeature(cell.cell, cell.estimate),
        ),
      },
    };
  }

  /** One Area's finished hours, or — with `current` — this hour so far for every live Area. */
  async runtime(
    context: AccountContext,
    query: { areaId?: string; hours: number; current: 'true' | 'false' },
  ): Promise<AdminRuntimeResponseDto> {
    if (query.current === 'true') {
      const { areas } = await this.catalog.placeQueries.call('listAreas', {}, context);
      const now = await this.analytics.reads.call(
        'getCurrentActivity',
        { areaIds: areas.map((area) => area.id) },
        context,
      );
      const byId = new Map(areas.map((area) => [area.id, area]));
      return {
        current: {
          hourStart: fromProtoTimestamp(now.hourStart, 'hourStart').toISOString(),
          areas: now.areas.flatMap((activity) => {
            const area = byId.get(activity.areaId);
            return area === undefined
              ? []
              : [
                  {
                    areaId: area.id,
                    code: area.code,
                    name: area.nameVi,
                    estimate: activity.estimate,
                  },
                ];
          }),
        },
      };
    }
    const { hours } = await this.analytics.reads.call(
      'getRuntimeActivity',
      { areaId: query.areaId!, hours: query.hours },
      context,
    );
    return {
      hours: hours.map((hour) => ({
        hourStart: fromProtoTimestamp(hour.hourStart, 'hourStart').toISOString(),
        estimate: hour.estimate,
      })),
    };
  }
}
