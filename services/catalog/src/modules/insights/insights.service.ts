import { Injectable } from '@nestjs/common';
import { businessDaysBetween, PlaceStatus, zBusinessDay } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { rpcError } from '@wayfare/nest-common';
import { Prisma } from '../../../generated/prisma/client';
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
    if (request.points.length === 0) return { places: [] };
    // One statement for every point: a read that queried each point on its own connection took
    // ten of the pool's at once, starving the event consumers and the outbox relay under load.
    const points = Prisma.join(
      request.points.map(
        (point, index) => Prisma.sql`(${index}::int, ${point.lng}::float8, ${point.lat}::float8)`,
      ),
    );
    const rows = await this.prisma.$queryRaw<{ index: number; id: string; nameVi: string }[]>`
      SELECT o.index, nearest.id, nearest."nameVi"
      FROM (VALUES ${points}) AS o(index, lng, lat)
      CROSS JOIN LATERAL (
        SELECT p.id, p.name_vi AS "nameVi"
        FROM places p
        WHERE p.status = ${PlaceStatus.ACTIVE} AND p.deleted_at IS NULL
          AND ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(o.lng, o.lat), 4326)::geography,
                         ${request.radiusM})
        ORDER BY p.location <-> ST_SetSRID(ST_MakePoint(o.lng, o.lat), 4326)::geography, p.id
        LIMIT 1
      ) AS nearest
      ORDER BY o.index`;
    return {
      places: rows.map((row) => ({ index: row.index, placeId: row.id, nameVi: row.nameVi })),
    };
  }
}
