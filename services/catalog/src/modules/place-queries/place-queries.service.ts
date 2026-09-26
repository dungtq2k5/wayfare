import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  businessDay,
  canonicalPublicCode,
  datasetVersionFromWire,
  MapPackStatus,
  MAX_NEARBY_RADIUS_M,
  NEARBY_LIMIT_MAX,
  PlaceStatus,
  zCategoryCode,
  zPublicCode,
  zRequestedLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import type { GeoPoint } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { rankNearby, walkingEtaMinutes } from '@wayfare/core';
import { parseRpcRequest, requireDeviceContext, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { objectsOf, packBytes } from '../map-packs/domain/map-pack-objects';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import {
  CATEGORY_SELECT,
  DETAIL_PLACE_SELECT,
  SUMMARY_PLACE_SELECT,
  SYNC_PLACE_SELECT,
  toArea,
  toCategory,
  toPlaceDetail,
  toPlaceSummary,
  toPlaceSyncRecord,
} from './place-query.mapper';
import type { AreaRow } from './place-query.mapper';

// Widened: statuses are read from the database as plain strings.
const ACTIVE: string = PlaceStatus.ACTIVE;

/** How many nearest candidates a nearby answer ranks — the reason a boost cannot reach further. */
export const NEARBY_CANDIDATE_CAP = 200;

/** A nearby answer's default size. */
export const NEARBY_LIMIT_DEFAULT = 20;

const zSince = z.string().transform((value, ctx) => {
  if (value === '') return 0n;
  try {
    return BigInt(datasetVersionFromWire(value));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Expected a non-negative safe integer' });
    return z.NEVER;
  }
});

const syncFields = z.object({ areaId: zUuidV7, lang: zRequestedLanguage, since: zSince });

const nearbyFields = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(1).max(MAX_NEARBY_RADIUS_M),
  lang: zRequestedLanguage,
  categoryCode: zCategoryCode.optional(),
  limit: z
    .number()
    .int()
    .min(0)
    .max(NEARBY_LIMIT_MAX)
    .transform((value) => (value === 0 ? NEARBY_LIMIT_DEFAULT : value)),
});

const getFields = z.object({ placeId: zUuidV7, lang: zRequestedLanguage });

const byCodeFields = z.object({ publicCode: zPublicCode, lang: zRequestedLanguage });

const resolveFields = z.object({ publicCode: z.string().max(64) });

/** The rows the fallback chain can reach for `requested` (conventions §11.2). */
function reachableLanguages(requested: string | null): string[] {
  return [...new Set([...(requested === null ? [] : [requested]), 'en'])];
}

/** Narrows a select's localizations — Place and menu — to the reachable languages. */
function withLanguages<S extends { localizations: object }>(select: S, langs: string[]): S {
  return { ...select, localizations: { ...select.localizations, where: { lang: { in: langs } } } };
}

/**
 * The tourist read path (api-endpoints-plan §2.1): delta sync, nearby, detail, QR resolution,
 * categories and areas. Serves only `ACTIVE`, non-deleted Places.
 */
@Injectable()
export class PlaceQueriesService {
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    config: ConfigService<Env, true>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  /**
   * One delta page (rdm-spec §1.7): full records for what is live in the area, ids for every
   * other change. A first sync lists only live Places — a new client has nothing to remove.
   */
  async syncPlaces(
    request: catalogGrpc.SyncPlacesRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.SyncPlacesResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(syncFields, request);
    await this.requireActiveArea(fields.areaId);
    const page = await this.sync.changes({ areaId: fields.areaId, since: fields.since });
    const live = page.changes.filter((change) => change.live).map((change) => change.id);
    const records = await this.syncRecords(live, fields.lang.lang);
    return {
      places: live.flatMap((id) => records.get(id) ?? []),
      removedPlaceIds:
        fields.since === 0n
          ? []
          : page.changes.filter((change) => !change.live).map((change) => change.id),
      datasetVersion: page.datasetVersion.toString(),
      complete: page.complete,
    };
  }

  /**
   * Nearby, ranked (api-endpoints-plan §2.1): the radius filter first, over the nearest
   * `NEARBY_CANDIDATE_CAP` candidates, then the boost reorders what is in range and flags it.
   */
  async nearbyPlaces(
    request: catalogGrpc.NearbyPlacesRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.NearbyPlacesResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(nearbyFields, request);
    // longitude first
    const candidates = await this.prisma.$queryRaw<
      { id: string; discoveryBoost: number; distanceM: number; lat: number; lng: number }[]
    >`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${fields.lng}, ${fields.lat}), 4326)::geography AS point
      )
      SELECT p.id, p.discovery_boost AS "discoveryBoost",
             ST_Distance(p.location, origin.point) AS "distanceM",
             ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
      FROM places p
      CROSS JOIN origin
      WHERE p.status = ${PlaceStatus.ACTIVE} AND p.deleted_at IS NULL
        AND ST_DWithin(p.location, origin.point, ${fields.radiusM})
        ${
          fields.categoryCode === undefined
            ? Prisma.empty
            : Prisma.sql`AND p.category_id = (SELECT id FROM categories WHERE code = ${fields.categoryCode})`
        }
      ORDER BY p.location <-> origin.point, p.id
      LIMIT ${NEARBY_CANDIDATE_CAP}`;
    const ranked = rankNearby(candidates).slice(0, fields.limit);
    const rows = await this.prisma.place.findMany({
      where: { id: { in: ranked.map((item) => item.id) } },
      select: withLanguages(SUMMARY_PLACE_SELECT, reachableLanguages(fields.lang.lang)),
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      places: ranked.flatMap((item) => {
        const row = byId.get(item.id);
        if (row === undefined) return [];
        const distanceM = Math.round(item.distanceM);
        return [
          toPlaceSummary(
            row,
            {
              location: { lat: item.lat, lng: item.lng },
              distanceM,
              walkingEtaMinutes: walkingEtaMinutes(distanceM),
              sponsored: item.sponsored,
            },
            fields.lang.lang,
            this.mediaBase,
          ),
        ];
      }),
    };
  }

  /** A live Place's detail; anything else is not found (api-endpoints-plan §2.1). */
  async getPlace(
    request: catalogGrpc.GetPlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetPlaceResponse> {
    const deviceId = requireDeviceContext(context);
    const fields = parseRpcRequest(getFields, request);
    const place = await this.detail(
      { id: fields.placeId },
      fields.lang.lang,
      deviceId,
      context.kind === 'account' ? context.userId : null,
    );
    if (!place?.live) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    return { place: place.detail };
  }

  /** A deep link's Place: a known code whose Place is gone is `PLACE_UNAVAILABLE`. */
  async getPlaceByCode(
    request: catalogGrpc.GetPlaceByCodeRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetPlaceByCodeResponse> {
    const deviceId = requireDeviceContext(context);
    const fields = parseRpcRequest(byCodeFields, request);
    const place = await this.detail(
      { publicCode: fields.publicCode },
      fields.lang.lang,
      deviceId,
      context.kind === 'account' ? context.userId : null,
    );
    if (place === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    if (!place.live) throw rpcError('PLACE_UNAVAILABLE');
    return { place: place.detail };
  }

  /**
   * A sticker scan (rdm-spec C-15): counts one scan for the business day when the code names any
   * Place, live or not. The gateway redirects either way.
   */
  async resolvePublicCode(
    request: catalogGrpc.ResolvePublicCodeRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.ResolvePublicCodeResponse> {
    const fields = parseRpcRequest(resolveFields, request);
    const code = canonicalPublicCode(fields.publicCode);
    if (code === null) return { exists: false };
    const day = businessDay(new Date());
    const counted = await this.prisma.$queryRaw<{ place_id: string }[]>`
      INSERT INTO place_qr_scans_daily (place_id, day, scans)
      SELECT id, ${day}::date, 1 FROM places WHERE public_code = ${code}
      ON CONFLICT (place_id, day) DO UPDATE SET scans = place_qr_scans_daily.scans + 1
      RETURNING place_id`;
    return { exists: counted.length > 0 };
  }

  /** Active categories in display order. */
  async listCategories(
    _request: catalogGrpc.ListCategoriesRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.ListCategoriesResponse> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { categories: rows.map(toCategory) };
  }

  /** Active areas, each with the dataset version a first sync reaches. */
  async listAreas(
    _request: catalogGrpc.ListAreasRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.ListAreasResponse> {
    const [rows, cap] = await Promise.all([
      this.prisma.$queryRaw<AreaRow[]>`
        SELECT id, code, name_vi AS "nameVi",
               ST_AsGeoJSON(boundary) AS "boundaryGeojson",
               ST_Y(center::geometry) AS "centerLat", ST_X(center::geometry) AS "centerLng",
               default_zoom AS "defaultZoom", sort_order AS "sortOrder"
        FROM areas
        WHERE is_active
        ORDER BY sort_order, code`,
      this.sync.cap(),
    ]);
    const packs = await this.prisma.mapPack.findMany({
      where: { areaId: { in: rows.map((row) => row.id) }, status: MapPackStatus.PUBLISHED },
    });
    const published = new Map(
      packs.map((pack) => [
        pack.areaId,
        { version: pack.version, bytes: packBytes(objectsOf(pack)) },
      ]),
    );
    return { areas: rows.map((row) => toArea(row, cap, published.get(row.id) ?? null)) };
  }

  private async requireActiveArea(areaId: string): Promise<void> {
    const area = await this.prisma.area.findUnique({
      where: { id: areaId },
      select: { isActive: true },
    });
    if (!area?.isActive) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'AREA' });
  }

  /**
   * Summaries of these Places in `requested`, with no origin — no distance, no walking time, never
   * sponsored. The favourites list reuses them; a Place not found is left out.
   */
  async summaries(
    ids: readonly string[],
    requested: string | null,
  ): Promise<Map<string, catalogGrpc.PlaceSummary>> {
    if (ids.length === 0) return new Map();
    const [rows, locations] = await Promise.all([
      this.prisma.place.findMany({
        where: { id: { in: [...ids] } },
        select: withLanguages(SUMMARY_PLACE_SELECT, reachableLanguages(requested)),
      }),
      this.locations(ids),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        toPlaceSummary(
          row,
          {
            location: locations.get(row.id)!,
            distanceM: 0,
            walkingEtaMinutes: 0,
            sponsored: false,
          },
          requested,
          this.mediaBase,
        ),
      ]),
    );
  }

  /** The `/sync/places` records of these Places in `requested`; the offline snapshot reuses them. */
  async syncRecords(
    ids: readonly string[],
    requested: string | null,
  ): Promise<Map<string, catalogGrpc.PlaceSyncRecord>> {
    if (ids.length === 0) return new Map();
    const [rows, locations] = await Promise.all([
      this.prisma.place.findMany({
        where: { id: { in: [...ids] } },
        select: withLanguages(SYNC_PLACE_SELECT, reachableLanguages(requested)),
      }),
      this.locations(ids),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        toPlaceSyncRecord(row, locations.get(row.id)!, requested, this.mediaBase),
      ]),
    );
  }

  private async detail(
    where: Prisma.PlaceWhereUniqueInput,
    requested: string | null,
    deviceId: string,
    userId: string | null,
  ): Promise<{ live: false } | { live: true; detail: catalogGrpc.PlaceDetail } | null> {
    const langs = reachableLanguages(requested);
    const select = withLanguages(DETAIL_PLACE_SELECT, langs);
    const row = await this.prisma.place.findUnique({
      where,
      select: {
        ...select,
        status: true,
        deletedAt: true,
        menuItems: { ...select.menuItems, select: withLanguages(select.menuItems.select, langs) },
      },
    });
    if (row === null) return null;
    if (row.status !== ACTIVE || row.deletedAt !== null) return { live: false };
    const [locations, isFavorite] = await Promise.all([
      this.locations([row.id]),
      this.isFavorite(row.id, deviceId, userId),
    ]);
    return {
      live: true,
      detail: toPlaceDetail(row, locations.get(row.id)!, requested, this.mediaBase, isFavorite),
    };
  }

  /** Whether the calling device, or the signed-in account on any of its devices, saved the Place. */
  private async isFavorite(
    placeId: string,
    deviceId: string,
    userId: string | null,
  ): Promise<boolean> {
    const saved = await this.prisma.favorite.findFirst({
      where: { placeId, OR: userId === null ? [{ deviceId }] : [{ deviceId }, { userId }] },
      select: { deviceId: true },
    });
    return saved !== null;
  }

  private async locations(ids: readonly string[]): Promise<Map<string, GeoPoint>> {
    const rows = await this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
      SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM places WHERE id = ANY(${[...ids]}::uuid[])`;
    return new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
  }
}
