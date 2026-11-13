import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  canonicalPublicCode,
  PlaceStatus,
  TourStatus,
  zPhotoVariants,
  zPublicCode,
  zRequestedLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import { contentTierProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { resolveContentTier, TOUR_MIN_LIVE_STOPS, tourStops } from '@wayfare/core';
import {
  decodeCursor,
  encodeCursor,
  parseRpcRequest,
  requireDeviceContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { zSince } from '../place-queries/place-queries.service';
import { toPlaceLocalization } from '../place-queries/place-query.mapper';
import { toPhotoVariantViews, toPhotoView } from '../places/place.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import { isLiveStop, readTourStops } from '../tours/domain/tour-stops';

// Widened: statuses are read from the database as plain strings.
const ACTIVE: string = TourStatus.ACTIVE;

const SYNC_PAGE = 200;
const LIST_LIMIT_DEFAULT = 20;

const listFields = z.object({
  areaId: zUuidV7,
  lang: zRequestedLanguage,
  page: z
    .object({ cursor: z.string().optional(), limit: z.number().int().min(0).max(100) })
    .optional(),
});
const getFields = z.object({ tourId: zUuidV7, lang: zRequestedLanguage });
const byCodeFields = z.object({ publicCode: zPublicCode, lang: zRequestedLanguage });
const syncFields = z.object({
  areaId: zUuidV7,
  lang: zRequestedLanguage,
  since: zSince,
});

/** The rows the fallback chain can reach for `requested`. */
const reachable = (requested: string | null): string[] => [
  ...new Set([...(requested === null ? [] : [requested]), 'en']),
];

/** A tour as the tourist reads load it. */
const TOUR_SELECT = {
  id: true,
  publicCode: true,
  areaId: true,
  area: { select: { code: true, isActive: true } },
  titleVi: true,
  descriptionVi: true,
  contentHash: true,
  coverVariants: true,
  estimatedMinutes: true,
  distanceM: true,
  status: true,
  deletedAt: true,
  syncVersion: true,
  localizations: {
    select: { lang: true, title: true, description: true, sourceContentHash: true },
  },
} as const satisfies Prisma.TourSelect;
type TourRow = Prisma.TourGetPayload<{ select: typeof TOUR_SELECT }>;

/**
 * Tours as a tourist reads them (api-endpoints-plan §2.2) and the phone syncs them (§2.1). A tour
 * is shown while it is `ACTIVE`, not deleted, in an active area, with at least two live stops
 * (rdm-spec C-8); its stops keep their positions, a stop whose Place isn't live is a gap.
 */
@Injectable()
export class TourQueriesService {
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    config: ConfigService<Env, true>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  /** An area's tours, in the order they were made; cursor style. */
  async listTours(
    request: catalogGrpc.ListToursRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.ListToursResponse> {
    const fields = parseRpcRequest(listFields, request);
    const limit = fields.page?.limit || LIST_LIMIT_DEFAULT;
    const cursor =
      fields.page?.cursor === undefined || fields.page.cursor === ''
        ? null
        : decodeCursor(fields.page.cursor);
    if (fields.page?.cursor !== undefined && fields.page.cursor !== '' && cursor === null) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid' }] });
    }
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM tours t JOIN areas a ON a.id = t.area_id
      WHERE t.area_id = ${fields.areaId}::uuid AND a.is_active
        AND t.status = ${TourStatus.ACTIVE} AND t.deleted_at IS NULL
        ${cursor === null ? Prisma.empty : Prisma.sql`AND t.id > ${cursor.id}::uuid`}
        AND (SELECT count(*) FROM tour_stops s JOIN places p ON p.id = s.place_id
             WHERE s.tour_id = t.id AND p.status = ${PlaceStatus.ACTIVE}
               AND p.deleted_at IS NULL AND p.area_id = t.area_id) >= ${TOUR_MIN_LIVE_STOPS}
      ORDER BY t.id
      LIMIT ${limit + 1}`;
    const page = ids.slice(0, limit);
    const rows = await this.prisma.tour.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      select: this.withLanguages(fields.lang.lang),
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const tours = await Promise.all(
      page.flatMap(({ id }) => {
        const row = byId.get(id);
        return row === undefined ? [] : [this.summary(row, fields.lang.lang)];
      }),
    );
    return {
      tours,
      page: {
        nextCursor: ids.length > limit ? encodeCursor({ id: page.at(-1)!.id }) : undefined,
      },
    };
  }

  async getTour(
    request: catalogGrpc.GetTourRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.GetTourResponse> {
    const fields = parseRpcRequest(getFields, request);
    return { tour: await this.detail({ id: fields.tourId }, fields.lang.lang) };
  }

  async getTourByCode(
    request: catalogGrpc.GetTourByCodeRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.GetTourByCodeResponse> {
    const fields = parseRpcRequest(byCodeFields, request);
    const code = canonicalPublicCode(fields.publicCode) ?? fields.publicCode;
    return { tour: await this.detail({ publicCode: code }, fields.lang.lang) };
  }

  /**
   * One delta page of an area's tours (rdm-spec §1.7): full records for the live ones, ids for every
   * other change. The stops are Place ids by position — the phone decides which are live from its
   * own Places, as `detail` does here. A first sync lists only live tours.
   */
  async syncTours(
    request: catalogGrpc.SyncToursRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.SyncToursResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(syncFields, request);
    // By the tour's own version and its localizations' for this language (rdm-spec §1.7).
    const {
      changes: page,
      datasetVersion,
      complete,
    } = await this.sync.tourChanges({
      areaId: fields.areaId,
      since: fields.since,
      lang: fields.lang.lang,
      pageSize: SYNC_PAGE,
    });
    const live = page.filter((change) => change.live).map((change) => change.id);
    const rows = await this.prisma.tour.findMany({
      where: { id: { in: live } },
      select: {
        ...this.withLanguages(fields.lang.lang),
        stops: { select: { position: true, placeId: true }, orderBy: { position: 'asc' } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      tours: live.flatMap((id) => {
        const row = byId.get(id);
        if (row === undefined) return [];
        return [
          {
            id: row.id,
            publicCode: row.publicCode,
            areaId: row.areaId,
            text: this.text(row, fields.lang.lang),
            cover: this.cover(row.coverVariants),
            estimatedMinutes: row.estimatedMinutes,
            distanceM: row.distanceM,
            stops: row.stops,
            syncVersion: row.syncVersion.toString(),
          },
        ];
      }),
      removedTourIds:
        fields.since === 0n ? [] : page.filter((change) => !change.live).map((change) => change.id),
      datasetVersion: datasetVersion.toString(),
      complete,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────────────────

  private withLanguages(requested: string | null) {
    return {
      ...TOUR_SELECT,
      localizations: {
        ...TOUR_SELECT.localizations,
        where: { lang: { in: reachable(requested) } },
      },
    } as const;
  }

  /**
   * A tour's detail. Unknown: `RESOURCE_NOT_FOUND`. Known but not shown — inactive, deleted, in an
   * inactive area, or under two live stops: `TOUR_UNAVAILABLE` with its area (TM5b, TW3).
   */
  private async detail(
    where: { id: string } | { publicCode: string },
    requested: string | null,
  ): Promise<catalogGrpc.TourDetail> {
    const row = await this.prisma.tour.findUnique({
      where,
      select: this.withLanguages(requested),
    });
    if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'TOUR' });
    const stored = await readTourStops(this.prisma, row.id);
    const legs = tourStops(
      stored.map((stop) => ({
        position: stop.position,
        live: isLiveStop(stop, row.areaId) ? { lat: stop.lat, lng: stop.lng } : null,
      })),
    );
    const liveCount = legs.filter((leg) => leg.live).length;
    if (
      row.status !== ACTIVE ||
      row.deletedAt !== null ||
      !row.area.isActive ||
      liveCount < TOUR_MIN_LIVE_STOPS
    ) {
      throw rpcError('TOUR_UNAVAILABLE', { areaCode: row.area.code });
    }
    const places = await this.prisma.place.findMany({
      where: {
        id: { in: stored.filter((stop) => isLiveStop(stop, row.areaId)).map((s) => s.placeId) },
      },
      select: {
        id: true,
        nameVi: true,
        descriptionVi: true,
        contentHash: true,
        localizations: {
          where: { lang: { in: reachable(requested) } },
          select: {
            lang: true,
            name: true,
            description: true,
            sourceContentHash: true,
            audioStatus: true,
            audioSourceContentHash: true,
            audioObjectPath: true,
            audioSha256: true,
            audioBytes: true,
            audioDurationMs: true,
            syncVersion: true,
          },
        },
        photos: {
          select: { variants: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
    });
    const byId = new Map(places.map((place) => [place.id, place]));
    const stops = legs.map((leg, index) => {
      const stop = stored[index]!;
      const place = leg.live ? byId.get(stop.placeId) : undefined;
      return {
        position: leg.position,
        legM: leg.legM,
        place:
          place === undefined
            ? undefined
            : {
                id: stop.placeId,
                publicCode: stop.publicCode,
                categoryCode: stop.categoryCode,
                location: { lat: stop.lat, lng: stop.lng },
                name: toPlaceLocalization(place, requested, this.mediaBase).name,
                nameVi: stop.nameVi,
                cardPhoto:
                  place.photos[0] === undefined
                    ? undefined
                    : toPhotoView(
                        zPhotoVariants.parse(place.photos[0].variants).card,
                        this.mediaBase,
                      ),
              },
      };
    });
    return {
      summary: { ...(await this.summary(row, requested)), stopCount: liveCount },
      cover:
        row.coverVariants === null
          ? undefined
          : toPhotoVariantViews(row.coverVariants, this.mediaBase),
      stops,
    };
  }

  private async summary(row: TourRow, requested: string | null): Promise<catalogGrpc.TourSummary> {
    const [counted] = await this.prisma.$queryRaw<{ live: number }[]>`
      SELECT count(*)::int AS live FROM tour_stops s JOIN places p ON p.id = s.place_id
      WHERE s.tour_id = ${row.id}::uuid AND p.status = ${PlaceStatus.ACTIVE}
        AND p.deleted_at IS NULL AND p.area_id = ${row.areaId}::uuid`;
    return {
      id: row.id,
      publicCode: row.publicCode,
      areaId: row.areaId,
      areaCode: row.area.code,
      text: this.text(row, requested),
      cover: this.cover(row.coverVariants),
      estimatedMinutes: row.estimatedMinutes,
      distanceM: row.distanceM,
      stopCount: counted?.live ?? 0,
    };
  }

  /** The tour's text in `requested`, through the one fallback chain (rdm-spec §1.5). */
  private text(row: TourRow, requested: string | null): catalogGrpc.TourText {
    const resolved = resolveContentTier({
      requested,
      localizations: row.localizations.map((l) => ({
        lang: l.lang,
        name: l.title,
        description: l.description,
        sourceContentHash: l.sourceContentHash,
      })),
      source: { name: row.titleVi, description: row.descriptionVi, contentHash: row.contentHash },
    });
    return {
      lang: resolved.lang,
      title: resolved.name,
      description: resolved.description ?? '',
      contentTier: contentTierProto.toProto(resolved.tier),
      stale: resolved.stale,
    };
  }

  private cover(variants: Prisma.JsonValue) {
    return variants === null
      ? undefined
      : toPhotoView(zPhotoVariants.parse(variants).card, this.mediaBase);
  }
}
