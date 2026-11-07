import { Injectable } from '@nestjs/common';
import { businessDaysBetween, PlaceStatus, zBusinessDay } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { rpcError } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

/** The longest range one QR read covers, in business days (the dashboards ask at most 93). */
const MAX_DAYS = 400;

/** The most points one label read takes: the heatmap labels its ten busiest squares. */
const MAX_POINTS = 50;

/** The widest radius a label looks in, metres. */
const MAX_RADIUS_M = 1_000;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** What the analytics dashboards read from catalog (api-endpoints-plan §7). */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  /** QR scans per Place and business day (rdm-spec C-15); every Place summed when none is named. */
  async getQrScans(
    request: catalogGrpc.GetQrScansRequest,
  ): Promise<catalogGrpc.GetQrScansResponse> {
    const from = zBusinessDay.safeParse(request.fromDay);
    const to = zBusinessDay.safeParse(request.toDay);
    if (
      !from.success ||
      !to.success ||
      from.data > to.data ||
      businessDaysBetween(from.data, to.data).length > MAX_DAYS
    ) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/fromDay', code: 'invalid' }] });
    }
    const day = { gte: new Date(`${from.data}T00:00:00Z`), lte: new Date(`${to.data}T00:00:00Z`) };
    if (request.placeIds.length === 0) {
      const rows = await this.prisma.placeQrScanDaily.groupBy({
        by: ['day'],
        where: { day },
        _sum: { scans: true },
        orderBy: { day: 'asc' },
      });
      return {
        days: rows.map((row) => ({ placeId: '', day: dayOf(row.day), scans: row._sum.scans ?? 0 })),
      };
    }
    const rows = await this.prisma.placeQrScanDaily.findMany({
      where: { placeId: { in: request.placeIds }, day, scans: { gt: 0 } },
      orderBy: [{ day: 'asc' }, { placeId: 'asc' }],
    });
    return {
      days: rows.map((row) => ({ placeId: row.placeId, day: dayOf(row.day), scans: row.scans })),
    };
  }

  /** For each point, the nearest live Place within the radius — the heatmap's labels. */
  async nearestLivePlaces(
    request: catalogGrpc.NearestLivePlacesRequest,
  ): Promise<catalogGrpc.NearestLivePlacesResponse> {
    if (
      request.points.length > MAX_POINTS ||
      request.radiusM <= 0 ||
      request.radiusM > MAX_RADIUS_M
    )
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/points', code: 'invalid' }] });
    const found = await Promise.all(
      request.points.map(async (point, index) => {
        const [nearest] = await this.prisma.$queryRaw<{ id: string; nameVi: string }[]>`
          WITH origin AS (
            SELECT ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography AS point
          )
          SELECT p.id, p.name_vi AS "nameVi"
          FROM places p, origin
          WHERE p.status = ${PlaceStatus.ACTIVE} AND p.deleted_at IS NULL
            AND ST_DWithin(p.location, origin.point, ${request.radiusM})
          ORDER BY p.location <-> origin.point, p.id
          LIMIT 1`;
        return nearest === undefined
          ? []
          : [{ index, placeId: nearest.id, nameVi: nearest.nameVi }];
      }),
    );
    return { places: found.flat() };
  }
}
