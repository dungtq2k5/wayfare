import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  CATALOG_TOUR_CONTENT_CHANGED,
  CONTENT_LANGUAGES,
  MIN_TOUR_STOPS_TO_ACTIVATE,
  newId,
  PlaceStatus,
  TOUR_STATUSES,
  TourStatus,
  trimTrailingSlashes,
  UploadPurpose,
  zPageQuery,
  zTourCreateInput,
  zTourStops,
  zUuidV7,
} from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import { tourStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { tourDistanceM } from '@wayfare/core';
import {
  contentHash,
  escapeLike,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
  SYSTEM_ORIGIN,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { AREAS_LOCK_KEY } from '../areas/domain/area-rules';
import { placeAuditRecord } from '../places/domain/place-audit';
import {
  isIllegalTransition,
  PlaceLifecycleEvent,
  transition,
} from '../places/domain/place-lifecycle';
import {
  PUBLIC_CODE_ATTEMPTS,
  PUBLIC_CODE_ENTROPY_BYTES,
  publicCodeFrom,
} from '../places/domain/public-code';
import { objectPathsOf, stickerSvg } from '../places/places.service';
import { PrismaService } from '../prisma/prisma.service';
import { bumpTourSyncVersion, withSyncWrite } from '../sync/sync.service';
import type { CatalogTx } from '../sync/sync.service';
import { UploadsService } from '../uploads/uploads.service';
import { tourGate } from './domain/tour-gate';
import type { TourGateMissing } from './domain/tour-gate';
import { readTourStops } from './domain/tour-stops';
import { toAdminTour, toAdminTourListItem } from './tour.mapper';
import type { AdminTourListRow } from './tour.mapper';

const TOUR_SORT_COLUMNS = {
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  titleVi: 'title_vi',
} as const;

const create = zTourCreateInput.shape;
const tourIdField = z.object({ tourId: zUuidV7 });

/** A proto3 `optional`: absent is unchanged. */
const createFields = z
  .object({
    titleVi: create.titleVi,
    descriptionVi: create.descriptionVi,
    areaId: create.areaId,
    estimatedMinutes: create.estimatedMinutes,
    coverUploadId: create.coverUploadId,
    placeIds: zTourStops,
    requestActivation: z.boolean(),
  })
  .superRefine((input, context) => {
    // The product's rule: a tour asked to go live has at least two stops (api §3.6).
    if (input.requestActivation && input.placeIds.length < MIN_TOUR_STOPS_TO_ACTIVATE) {
      context.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: MIN_TOUR_STOPS_TO_ACTIVATE,
        inclusive: true,
        path: ['placeIds'],
        message: 'Requesting activation needs at least two stops',
      });
    }
  });

const updateFields = z.object({
  tourId: zUuidV7,
  titleVi: create.titleVi.optional(),
  descriptionVi: create.descriptionVi.optional(),
  estimatedMinutes: create.estimatedMinutes.optional(),
  coverUploadId: zUuidV7.optional(),
  removeCover: z.boolean(),
});

const stopsFields = z.object({ tourId: zUuidV7, placeIds: zTourStops });

const qrFields = z.object({
  tourId: zUuidV7,
  qrBaseUrl: z.url({ protocol: /^https?$/ }).transform((value) => trimTrailingSlashes(value)),
});

const listFields = z.object({
  page: zPageQuery({
    sort: ['updatedAt', 'createdAt', 'titleVi'],
    defaultSort: '-updatedAt',
    search: true,
  }),
  status: z.number().optional(),
  areaId: zUuidV7.optional(),
  includeDeleted: z.boolean(),
});

const issue = (path: string, code = 'invalid_value') =>
  rpcError('VALIDATION_FAILED', { issues: [{ path, code }] });

const DELETED = 'DELETED';

/** A tour's columns as a write locks them. */
interface LockedTour {
  readonly id: string;
  readonly publicCode: string;
  readonly areaId: string;
  readonly titleVi: string;
  readonly descriptionVi: string;
  readonly contentHash: string;
  readonly coverVariants: Prisma.JsonValue;
  readonly estimatedMinutes: number;
  readonly status: TourStatus;
  readonly activationRequestedAt: Date | null;
  readonly deletedAt: Date | null;
}

const tourContentHash = (title: string, description: string): string =>
  contentHash({ name: title, description });

/**
 * Staff administration of tours (api-endpoints-plan §3.6, rdm-spec C-8 to C-10): the text goes to
 * narration as a menu item's does (text only), the gate is the Place's on the English text, and the
 * stop list is replaced whole. Every write that a tourist could observe bumps the tour's
 * `sync_version` last, in `withSyncWrite`.
 */
@Injectable()
export class ToursService {
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly uploads: UploadsService,
    config: ConfigService<Env, true>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  async listTours(
    request: catalogGrpc.TourAdminServiceListToursRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.TourAdminServiceListToursResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const { page, pageSize, sort, q } = fields.page;
    const conditions: Prisma.Sql[] = [];
    if (!fields.includeDeleted) conditions.push(Prisma.sql`t.deleted_at IS NULL`);
    if (q !== undefined) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        Prisma.sql`(t.title_vi ILIKE ${pattern} ESCAPE '\\' OR t.public_code ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (fields.status !== undefined) {
      const status = tourStatusProto.fromProto(fields.status);
      if (status === null || !TOUR_STATUSES.includes(status)) throw issue('/status');
      conditions.push(Prisma.sql`t.status = ${status}`);
    }
    if (fields.areaId !== undefined) {
      conditions.push(Prisma.sql`t.area_id = ${fields.areaId}::uuid`);
    }
    const where =
      conditions.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const descending = sort.startsWith('-');
    const field = (descending ? sort.slice(1) : sort) as keyof typeof TOUR_SORT_COLUMNS;
    const direction = descending ? 'DESC' : 'ASC';
    // Both parts come from fixed tables above, never from the request.
    const orderBy = Prisma.raw(`t.${TOUR_SORT_COLUMNS[field]} ${direction}, t.id ${direction}`);
    const [counted, rows] = await Promise.all([
      this.prisma.$queryRaw<
        { total: number }[]
      >`SELECT count(*)::int AS total FROM tours t ${where}`,
      this.prisma.$queryRaw<AdminTourListRow[]>`
        SELECT t.id, t.public_code AS "publicCode", t.title_vi AS "titleVi", t.area_id AS "areaId",
               a.code AS "areaCode", t.status, t.inactive_reason AS "inactiveReason",
               t.estimated_minutes AS "estimatedMinutes", t.distance_m AS "distanceM",
               t.cover_variants AS "coverVariants", t.updated_at AS "updatedAt",
               t.deleted_at AS "deletedAt", t.activation_requested_at AS "activationRequestedAt",
               (SELECT count(*)::int FROM tour_stops s WHERE s.tour_id = t.id) AS "totalStops",
               (SELECT count(*)::int FROM tour_stops s JOIN places p ON p.id = s.place_id
                WHERE s.tour_id = t.id AND p.status = ${PlaceStatus.ACTIVE}
                  AND p.deleted_at IS NULL AND p.area_id = t.area_id) AS "liveStops"
        FROM tours t JOIN areas a ON a.id = t.area_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ]);
    return {
      tours: rows.map((row) => toAdminTourListItem(row, this.mediaBase)),
      page: { page, pageSize, total: counted[0]?.total ?? 0 },
    };
  }

  /** Every column, its stops as they stand and its translations — deleted tours included. */
  async getTourAdmin(
    request: catalogGrpc.GetTourAdminRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetTourAdminResponse> {
    requireAccountContext(context);
    const { tourId } = parseRpcRequest(tourIdField, request);
    return { tour: await this.view(this.prisma, tourId) };
  }

  /** A new tour: a draft, or processing at once when activation is requested (api §3.6). */
  async createTour(
    request: catalogGrpc.CreateTourRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.CreateTourResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(createFields, request);
    const now = new Date();
    const tourId = await withSyncWrite(this.prisma, async (tx) => {
      const area = await tx.area.findUnique({ where: { id: fields.areaId }, select: { id: true } });
      if (area === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'AREA' });
      if (fields.requestActivation) await this.requireActiveArea(tx, fields.areaId);
      const points = await this.checkStops(tx, fields.areaId, fields.placeIds, new Set());
      const cover =
        fields.coverUploadId === undefined
          ? null
          : (
              await this.uploads.consumeUpload(
                tx,
                fields.coverUploadId,
                actor.userId,
                UploadPurpose.TOUR_COVER,
              )
            ).variants;
      const hash = tourContentHash(fields.titleVi, fields.descriptionVi);
      const status = fields.requestActivation ? TourStatus.PROCESSING : TourStatus.DRAFT;
      const id = await this.insertTour(tx, {
        areaId: fields.areaId,
        titleVi: fields.titleVi,
        descriptionVi: fields.descriptionVi,
        contentHash: hash,
        coverVariants: cover,
        estimatedMinutes: fields.estimatedMinutes,
        distanceM: tourDistanceM(points),
        status,
        activationRequestedAt: fields.requestActivation ? now : null,
        createdById: actor.userId,
      });
      await this.writeStops(tx, id, fields.placeIds);
      await this.requestText(tx, id, hash, now);
      await this.audit(tx, actor, AuditAction.TOUR_CREATED, id, now, {
        after: { status, areaId: fields.areaId, placeIds: fields.placeIds },
      });
      if (fields.requestActivation) {
        await this.audit(tx, actor, AuditAction.TOUR_ACTIVATION_REQUESTED, id, now, {
          after: { status, missing: ['en.text'] },
        });
      }
      await bumpTourSyncVersion(tx, id);
      return id;
    });
    return { tour: await this.view(this.prisma, tourId) };
  }

  /**
   * Text, minutes and cover. A changed title or description asks narration again and sends a live
   * tour back through `PROCESSING` until its English is ready (rdm-spec §1.6); the rest doesn't.
   */
  async updateTour(
    request: catalogGrpc.UpdateTourRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.UpdateTourResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(updateFields, request);
    const now = new Date();
    const tour = await this.write(fields.tourId, async (tx, current) => {
      const titleVi = fields.titleVi ?? current.titleVi;
      const descriptionVi = fields.descriptionVi ?? current.descriptionVi;
      const hash = tourContentHash(titleVi, descriptionVi);
      const contentChanged = hash !== current.contentHash;
      const changedFields = [
        ...(titleVi === current.titleVi ? [] : ['titleVi']),
        ...(descriptionVi === current.descriptionVi ? [] : ['descriptionVi']),
        ...(fields.estimatedMinutes === undefined ||
        fields.estimatedMinutes === current.estimatedMinutes
          ? []
          : ['estimatedMinutes']),
        ...(fields.coverUploadId !== undefined || fields.removeCover ? ['cover'] : []),
      ];
      if (changedFields.length === 0) return false;
      const data: Prisma.TourUpdateInput = {
        titleVi,
        descriptionVi,
        contentHash: hash,
        ...(fields.estimatedMinutes === undefined
          ? {}
          : { estimatedMinutes: fields.estimatedMinutes }),
      };
      if (fields.coverUploadId !== undefined || fields.removeCover) {
        await this.orphanCover(tx, current.coverVariants);
        data.coverVariants =
          fields.coverUploadId === undefined
            ? Prisma.DbNull
            : (
                await this.uploads.consumeUpload(
                  tx,
                  fields.coverUploadId,
                  actor.userId,
                  UploadPurpose.TOUR_COVER,
                )
              ).variants;
      }
      if (contentChanged && current.status === TourStatus.ACTIVE) {
        data.status = this.next(current.status, PlaceLifecycleEvent.SOURCE_CHANGED);
      }
      await tx.tour.update({ where: { id: current.id }, data, select: { id: true } });
      if (contentChanged) await this.requestText(tx, current.id, hash, now);
      await this.audit(tx, actor, AuditAction.TOUR_UPDATED, current.id, now, {
        after: { changedFields, contentChanged },
      });
      return true;
    });
    return { tour };
  }

  /**
   * Replaces the ordered stop list whole (rdm-spec C-10). A Place outside the tour's area or
   * deleted is refused — unless it is already a stop: a Place moved out of the area by an edit, or
   * deleted since, stays where it is, and tourists see it as a gap.
   */
  async replaceTourStops(
    request: catalogGrpc.ReplaceTourStopsRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ReplaceTourStopsResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(stopsFields, request);
    const now = new Date();
    const tour = await this.write(fields.tourId, async (tx, current) => {
      const before = await tx.tourStop.findMany({
        where: { tourId: current.id },
        orderBy: { position: 'asc' },
        select: { placeId: true },
      });
      const beforeIds = before.map((stop) => stop.placeId);
      if (beforeIds.join() === fields.placeIds.join()) return false;
      const points = await this.checkStops(tx, current.areaId, fields.placeIds, new Set(beforeIds));
      await tx.tourStop.deleteMany({ where: { tourId: current.id } });
      await this.writeStops(tx, current.id, fields.placeIds);
      await tx.tour.update({
        where: { id: current.id },
        data: { distanceM: tourDistanceM(points) },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.TOUR_STOPS_REPLACED, current.id, now, {
        before: { placeIds: beforeIds },
        after: { placeIds: fields.placeIds },
      });
      return true;
    });
    return { tour };
  }

  /** As a Place's (rdm-spec §1.6): sets the request and evaluates the gate on the English text. */
  async requestTourActivation(
    request: catalogGrpc.RequestTourActivationRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RequestTourActivationResponse> {
    const actor = requireAccountContext(context);
    const { tourId } = parseRpcRequest(tourIdField, request);
    const now = new Date();
    let status: TourStatus = TourStatus.ACTIVE;
    let missing: TourGateMissing[] = [];
    await this.write(tourId, async (tx, current) => {
      if (current.status === TourStatus.ACTIVE) return false;
      await this.requireActiveArea(tx, current.areaId);
      status =
        current.status === TourStatus.PROCESSING
          ? current.status
          : this.next(current.status, PlaceLifecycleEvent.ACTIVATION_REQUESTED);
      const gate = tourGate({
        contentHash: current.contentHash,
        activationRequestedAt: now,
        enSourceContentHash: await this.enHash(tx, current.id),
      });
      missing = gate.missing;
      if (gate.open) status = TourStatus.ACTIVE;
      await tx.tour.update({
        where: { id: current.id },
        data: { status, inactiveReason: null, activationRequestedAt: now },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.TOUR_ACTIVATION_REQUESTED, current.id, now, {
        after: { status, missing },
      });
      if (gate.open) await this.audit(tx, actor, AuditAction.TOUR_ACTIVATED, current.id, now);
      return true;
    });
    return { status: tourStatusProto.toProto(status), missing };
  }

  /** Takes a live or processing tour offline. No reason: the tour route takes none (api §3.6). */
  async deactivateTour(
    request: catalogGrpc.DeactivateTourRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.DeactivateTourResponse> {
    const actor = requireAccountContext(context);
    const { tourId } = parseRpcRequest(tourIdField, request);
    const now = new Date();
    const tour = await this.write(tourId, async (tx, current) => {
      const status = this.next(current.status, PlaceLifecycleEvent.DEACTIVATED);
      await tx.tour.update({
        where: { id: current.id },
        data: { status, inactiveReason: 'ADMIN' },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.TOUR_DEACTIVATED, current.id, now, {
        before: { status: current.status },
      });
      return true;
    });
    return { tour };
  }

  /** Soft-deletes a tour; the bumped row is the sync tombstone. Its Places aren't touched. */
  async deleteTour(
    request: catalogGrpc.DeleteTourRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.DeleteTourResponse> {
    const actor = requireAccountContext(context);
    const { tourId } = parseRpcRequest(tourIdField, request);
    const now = new Date();
    await this.write(tourId, async (tx, current) => {
      await tx.tour.update({
        where: { id: current.id },
        data: { deletedAt: now, deletedById: actor.userId },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.TOUR_DELETED, current.id, now, {
        before: { status: current.status },
      });
      return true;
    });
    return {};
  }

  /** Restores a deleted tour with its status; its translations were kept, so its gate holds. */
  async restoreTour(
    request: catalogGrpc.RestoreTourRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RestoreTourResponse> {
    const actor = requireAccountContext(context);
    const { tourId } = parseRpcRequest(tourIdField, request);
    const now = new Date();
    const tour = await this.write(
      tourId,
      async (tx, current) => {
        if (current.deletedAt === null) throw rpcError('INVALID_STATE', { status: current.status });
        await tx.tour.update({
          where: { id: current.id },
          data: { deletedAt: null, deletedById: null },
          select: { id: true },
        });
        // Deleted while it waited for its English: asked again, or it would wait for good.
        if (current.status === TourStatus.PROCESSING) {
          await this.requestText(tx, current.id, current.contentHash, now);
        }
        await this.audit(tx, actor, AuditAction.TOUR_RESTORED, current.id, now, {
          before: { status: current.status },
        });
        return true;
      },
      { allowDeleted: true },
    );
    return { tour };
  }

  /** The sticker, as a Place's: an SVG QR of `<qrBaseUrl>/q/<code>`, the code printed beneath. */
  async getTourQr(
    request: catalogGrpc.GetTourQrRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetTourQrResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(qrFields, request);
    const tour = await this.prisma.tour.findUnique({
      where: { id: fields.tourId },
      select: { publicCode: true },
    });
    if (tour === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'TOUR' });
    const url = `${fields.qrBaseUrl}/q/${tour.publicCode}`;
    return { svg: await stickerSvg(url, tour.publicCode), publicCode: tour.publicCode };
  }

  /**
   * The gate, from the English text's arrival (the `narration.localization.ready` consumer): a
   * processing tour whose request stands goes live, audited as the system's act.
   */
  async openGateIfReady(tx: CatalogTx, tourId: string): Promise<boolean> {
    const [tour] = await tx.$queryRaw<
      {
        status: TourStatus;
        contentHash: string;
        activationRequestedAt: Date | null;
        deleted: boolean;
      }[]
    >`
      SELECT status, content_hash AS "contentHash",
             activation_requested_at AS "activationRequestedAt", deleted_at IS NOT NULL AS deleted
      FROM tours WHERE id = ${tourId}::uuid
      FOR UPDATE`;
    if (tour?.status !== TourStatus.PROCESSING) return false;
    const gate = tourGate({
      contentHash: tour.contentHash,
      activationRequestedAt: tour.activationRequestedAt,
      enSourceContentHash: await this.enHash(tx, tourId),
    });
    if (!gate.open) return false;
    await tx.tour.update({
      where: { id: tourId },
      data: { status: this.next(tour.status, PlaceLifecycleEvent.GATE_OPENED) },
      select: { id: true },
    });
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      placeAuditRecord({
        actor: { type: AuditActorType.SYSTEM },
        action: AuditAction.TOUR_ACTIVATED,
        placeId: tourId,
        resourceType: AuditResourceType.TOUR,
        origin: SYSTEM_ORIGIN,
        now: new Date(),
      }),
    );
    return true;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────────────────

  /** Locks the tour, applies, bumps when something changed, and answers the view. */
  private async write(
    tourId: string,
    apply: (tx: CatalogTx, tour: LockedTour) => Promise<boolean>,
    options: { allowDeleted?: boolean } = {},
  ): Promise<catalogGrpc.AdminTour> {
    try {
      return await withSyncWrite(this.prisma, async (tx) => {
        const [tour] = await tx.$queryRaw<LockedTour[]>`
          SELECT id, public_code AS "publicCode", area_id AS "areaId", title_vi AS "titleVi",
                 description_vi AS "descriptionVi", content_hash AS "contentHash",
                 cover_variants AS "coverVariants", estimated_minutes AS "estimatedMinutes",
                 status, activation_requested_at AS "activationRequestedAt",
                 deleted_at AS "deletedAt"
          FROM tours WHERE id = ${tourId}::uuid
          FOR UPDATE`;
        if (tour === undefined) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'TOUR' });
        if (tour.deletedAt !== null && options.allowDeleted !== true) {
          throw rpcError('INVALID_STATE', { status: DELETED });
        }
        if (await apply(tx, tour)) await bumpTourSyncVersion(tx, tour.id);
        return this.view(tx, tour.id);
      });
    } catch (error) {
      if (isIllegalTransition(error)) throw rpcError('INVALID_STATE', { status: error.from });
      throw error;
    }
  }

  /** The Place machine's transition, which a tour runs too (rdm-spec C-8). */
  private next(from: TourStatus, event: PlaceLifecycleEvent): TourStatus {
    return transition(from as string as PlaceStatus, event) as string as TourStatus;
  }

  /**
   * Checks a stop list against the tour's area and returns its points in order: each Place once,
   * in the area and not deleted — unless it is already a stop (`kept`).
   */
  private async checkStops(
    tx: CatalogTx,
    areaId: string,
    placeIds: readonly string[],
    kept: ReadonlySet<string>,
  ): Promise<{ lat: number; lng: number }[]> {
    const seen = new Set<string>();
    for (const [index, id] of placeIds.entries()) {
      if (seen.has(id)) throw issue(`/placeIds/${index}`, 'duplicate');
      seen.add(id);
    }
    if (placeIds.length === 0) return [];
    const rows = await tx.$queryRaw<
      { id: string; areaId: string; deleted: boolean; lat: number; lng: number }[]
    >`
      SELECT id, area_id AS "areaId", deleted_at IS NOT NULL AS deleted,
             ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM places WHERE id IN (${Prisma.join(placeIds.map((id) => Prisma.sql`${id}::uuid`))})`;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return placeIds.map((id, index) => {
      const place = byId.get(id);
      if (place === undefined) throw issue(`/placeIds/${index}`, 'not_found');
      if (!kept.has(id)) {
        if (place.deleted) throw issue(`/placeIds/${index}`, 'not_found');
        if (place.areaId !== areaId) throw issue(`/placeIds/${index}`, 'outside_area');
      }
      return { lat: place.lat, lng: place.lng };
    });
  }

  private async writeStops(tx: CatalogTx, tourId: string, placeIds: readonly string[]) {
    if (placeIds.length === 0) return;
    await tx.tourStop.createMany({
      data: placeIds.map((placeId, position) => ({ tourId, position, placeId })),
    });
  }

  /**
   * Inserts a tour with a fresh code in the one code space: a code any Place or tour holds is
   * skipped and another drawn (its `public_codes` row is written by the table's trigger).
   */
  private async insertTour(
    tx: CatalogTx,
    tour: {
      areaId: string;
      titleVi: string;
      descriptionVi: string;
      contentHash: string;
      coverVariants: Prisma.JsonValue | null;
      estimatedMinutes: number;
      distanceM: number;
      status: TourStatus;
      activationRequestedAt: Date | null;
      createdById: string;
    },
  ): Promise<string> {
    const id = newId();
    for (let attempt = 0; attempt < PUBLIC_CODE_ATTEMPTS; attempt++) {
      const code = publicCodeFrom(randomBytes(PUBLIC_CODE_ENTROPY_BYTES));
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO tours (
          id, public_code, area_id, title_vi, description_vi, content_hash, cover_variants,
          estimated_minutes, distance_m, status, activation_requested_at, sync_version,
          created_by_id, updated_at
        )
        SELECT ${id}::uuid, ${code}, ${tour.areaId}::uuid, ${tour.titleVi}, ${tour.descriptionVi},
               ${tour.contentHash},
               ${tour.coverVariants === null ? null : JSON.stringify(tour.coverVariants)}::jsonb,
               ${tour.estimatedMinutes}, ${tour.distanceM}, ${tour.status},
               ${tour.activationRequestedAt}, nextval('catalog_sync_version_seq'),
               ${tour.createdById}::uuid, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM public_codes WHERE code = ${code})
        ON CONFLICT (public_code) DO NOTHING
        RETURNING id`;
      if (inserted.length === 1) return id;
    }
    throw rpcError('SHORT_CODE_COLLISION');
  }

  /** Asks narration for the tour's text in every launch language (text only, no audio). */
  private async requestText(tx: CatalogTx, tourId: string, hash: string, now: Date) {
    await this.outbox.add(tx, CATALOG_TOUR_CONTENT_CHANGED, {
      occurredAt: now.toISOString(),
      tourId,
      contentHash: hash,
      langs: [...CONTENT_LANGUAGES],
    });
  }

  private async enHash(db: CatalogTx, tourId: string): Promise<string | null> {
    const en = await db.tourLocalization.findUnique({
      where: { tourId_lang: { tourId, lang: 'en' } },
      select: { sourceContentHash: true },
    });
    return en?.sourceContentHash ?? null;
  }

  private async orphanCover(tx: CatalogTx, variants: Prisma.JsonValue) {
    const paths = objectPathsOf(variants);
    if (paths.length === 0) return;
    await tx.orphanedObject.createMany({
      data: paths.map((objectPath) => ({ objectPath })),
      skipDuplicates: true,
    });
  }

  /** Refuses to take a tour live in an inactive area, under the areas lock (rdm-spec C-3). */
  private async requireActiveArea(tx: CatalogTx, areaId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${AREAS_LOCK_KEY}))`;
    const area = await tx.area.findUniqueOrThrow({
      where: { id: areaId },
      select: { isActive: true },
    });
    if (!area.isActive) throw rpcError('AREA_INACTIVE');
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    tourId: string,
    now: Date,
    metadata?: AuditRecordPayload['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      placeAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        placeId: tourId,
        resourceType: AuditResourceType.TOUR,
        ...(metadata === undefined ? {} : { metadata }),
        origin: actor.origin,
        now,
      }),
    );
  }

  /** A tour as the console shows it. */
  private async view(db: CatalogTx, tourId: string): Promise<catalogGrpc.AdminTour> {
    const tour = await db.tour.findUnique({
      where: { id: tourId },
      select: {
        id: true,
        publicCode: true,
        areaId: true,
        area: { select: { code: true } },
        titleVi: true,
        descriptionVi: true,
        contentHash: true,
        estimatedMinutes: true,
        distanceM: true,
        coverVariants: true,
        status: true,
        inactiveReason: true,
        activationRequestedAt: true,
        syncVersion: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        localizations: {
          select: { lang: true, sourceContentHash: true, translationSource: true },
        },
      },
    });
    if (tour === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'TOUR' });
    const stops = await readTourStops(db, tourId);
    const en = tour.localizations.find((row) => row.lang === 'en');
    const gate = tourGate({
      contentHash: tour.contentHash,
      activationRequestedAt: tour.activationRequestedAt,
      enSourceContentHash: en?.sourceContentHash ?? null,
    });
    return toAdminTour(tour, stops, gate.missing, this.mediaBase);
  }
}
