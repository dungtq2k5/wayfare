import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  CATALOG_MENU_CONTENT_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
  CATALOG_PLACE_STATUS_CHANGED,
  CategoryAppliesTo,
  CONTENT_LANGUAGES,
  effectiveLimit,
  MAX_ADMIN_REASON_LENGTH,
  MAX_PHOTOS_PER_PLACE,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  newId,
  normalizeText,
  NOTIFICATION_CREATE,
  NotificationType,
  PLACE_KINDS,
  PLACE_LIMIT_STATUSES,
  PLACE_STATUSES,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  scopeLanguages,
  scopeWidened,
  SOCKET_ROOMS,
  SubmissionKind,
  SubmissionStatus,
  SynthesisTrigger,
  trimTrailingSlashes,
  UploadPurpose,
  zMenuInput,
  zOpeningHours,
  zPageQuery,
  zPhotoSetItem,
  zPlaceContentInput,
  zUuidV7,
} from '@wayfare/contracts';
import type {
  AuditRecordPayload,
  BILLING_ENTITLEMENTS_CHANGED,
  IDENTITY_USER_ERASED,
  EventPayload,
  Language,
  GeoPoint,
  MenuInput,
  OpeningHoursRow,
  PlaceContentInput,
  PlaceSubmissionPayload,
} from '@wayfare/contracts';
import { menuCurrencyProto, placeKindProto, placeStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  contentHash,
  escapeLike,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext, SocketEmitter } from '@wayfare/nest-common';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { BillingPortService } from '../billing-port/billing-port.service';
import { SOCKET_EMITTER } from '../frames/frames.module';
import { OwnerEntitlementsService } from '../owner-entitlements/owner-entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { bumpSyncVersion, withSyncWrite } from '../sync/sync.service';
import type { CatalogTx } from '../sync/sync.service';
import { AREAS_LOCK_KEY } from '../areas/domain/area-rules';
import { UploadsService } from '../uploads/uploads.service';
import { ActivationGate } from './domain/activation-gate';
import type { GateMissing } from './domain/activation-gate';
import { placeAuditRecord, submissionAuditRecord } from './domain/place-audit';
import { snapshotOfPlace } from './domain/submission-diff';
import type { EditableSnapshot } from './domain/submission-diff';
import {
  isIllegalTransition,
  netVisibilityChange,
  PlaceLifecycleEvent,
  transition,
} from './domain/place-lifecycle';
import type { PlaceVisibility } from './domain/place-lifecycle';
import {
  PUBLIC_CODE_ATTEMPTS,
  PUBLIC_CODE_ENTROPY_BYTES,
  publicCodeFrom,
} from './domain/public-code';
import {
  ADMIN_PLACE_LIST_SELECT,
  ADMIN_PLACE_SELECT,
  toAdminPlace,
  toAdminPlaceListItem,
} from './place.mapper';

const PLACE_SORT_COLUMNS = {
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  nameVi: 'name_vi',
} as const;

const content = zPlaceContentInput.shape;

/** A proto3 `optional` string: absent is unchanged, empty clears. */
const zClearableText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable().optional());

/** An absent proto message decodes as null. */
const zMessage = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema);

/** A proto `PhotoSetItem`: an empty alt text is none. */
const zPhotoItem = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && 'altTextVi' in value && value.altTextVi === ''
      ? { ...value, altTextVi: undefined }
      : value,
  zPhotoSetItem,
);

const zTriggerRadius = z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M);
const zNarrationPriority = z.number().int().min(NARRATION_PRIORITY_MIN).max(NARRATION_PRIORITY_MAX);

const placeIdField = z.object({ placeId: zUuidV7 });

const createFields = z.object({
  content: zMessage(
    zPlaceContentInput.extend({
      addressVi: zClearableText(content.addressVi.unwrap().unwrap()),
      priceBand: z.preprocess((v) => (v === 0 ? null : v), content.priceBand),
      phone: zClearableText(content.phone.unwrap().unwrap()),
      websiteUrl: zClearableText(content.websiteUrl.unwrap().unwrap()),
      location: zMessage(content.location),
    }),
  ),
  triggerRadiusM: zTriggerRadius,
  narrationPriority: zNarrationPriority,
  photos: z.array(zPhotoItem).max(MAX_PHOTOS_PER_PLACE),
  openingHours: zOpeningHours,
  requestActivation: z.boolean(),
});

const updateFields = z.object({
  placeId: zUuidV7,
  nameVi: content.nameVi.optional(),
  descriptionVi: content.descriptionVi.optional(),
  categoryCode: content.categoryCode.optional(),
  location: z.preprocess((value) => value ?? undefined, content.location.optional()),
  addressVi: zClearableText(content.addressVi.unwrap().unwrap()),
  priceBand: z.preprocess((v) => (v === 0 ? null : v), content.priceBand),
  phone: zClearableText(content.phone.unwrap().unwrap()),
  websiteUrl: zClearableText(content.websiteUrl.unwrap().unwrap()),
});

const editorialFields = z.object({
  placeId: zUuidV7,
  triggerRadiusM: zTriggerRadius.optional(),
  narrationPriority: zNarrationPriority.optional(),
});

const photosFields = z.object({
  placeId: zUuidV7,
  items: z.array(zPhotoItem).max(MAX_PHOTOS_PER_PLACE),
});

const menuFields = z.object({
  placeId: zUuidV7,
  menuCurrency: z.number(),
  items: z.array(
    z.preprocess(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'descriptionVi' in value &&
        value.descriptionVi === ''
          ? { ...value, descriptionVi: undefined }
          : value,
      z.unknown(),
    ),
  ),
});

const hoursFields = z.object({ placeId: zUuidV7, rows: zOpeningHours });

const deactivateFields = z.object({
  placeId: zUuidV7,
  reason: z.string().transform(normalizeText).pipe(z.string().min(1).max(MAX_ADMIN_REASON_LENGTH)),
});

const qrFields = z.object({
  placeId: zUuidV7,
  qrBaseUrl: z.url({ protocol: /^https?$/ }).transform((value) => trimTrailingSlashes(value)),
});

const listFields = z.object({
  page: zPageQuery({
    sort: ['updatedAt', 'createdAt', 'nameVi'],
    defaultSort: '-updatedAt',
    search: true,
  }),
  kind: z.number().optional(),
  status: z.number().optional(),
  areaId: zUuidV7.optional(),
  categoryCode: content.categoryCode.optional(),
  ownerUserId: zUuidV7.optional(),
  includeDeleted: z.boolean(),
});

/** A Place locked for the rest of the transaction. */
interface LockedPlace {
  readonly id: string;
  readonly kind: PlaceKind;
  readonly ownerUserId: string | null;
  readonly publicCode: string;
  readonly categoryId: string;
  readonly areaId: string;
  readonly nameVi: string;
  readonly descriptionVi: string;
  readonly contentHash: string;
  readonly addressVi: string | null;
  readonly triggerRadiusM: number;
  readonly narrationPriority: number;
  readonly priceBand: number | null;
  readonly phone: string | null;
  readonly websiteUrl: string | null;
  readonly status: PlaceStatus;
  readonly inactiveReason: string | null;
  readonly activationRequestedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly lat: number;
  readonly lng: number;
}

/** A content edit: any subset of the content fields; `null` clears an optional one. */
type ContentChange = Omit<z.output<typeof updateFields>, 'placeId'>;

/** One photo of a replaced set. */
type PhotoSetItem = z.output<typeof zPhotoSetItem>;

/**
 * The development seed's committed id and public code (ADR 0002), never reachable over gRPC: a
 * committed code is tried once, and a collision is `SHORT_CODE_COLLISION`.
 */
export interface FixedPlace {
  readonly id?: string;
  readonly publicCode?: string;
}

/** catalog's admin view of a Place. */
export type AdminPlaceView = catalogGrpc.AdminPlace;

/** What an approval writes besides the payload: the reviewer's values (rdm-spec §1.4). */
export interface SubmissionApproval {
  readonly reviewer: AccountContext;
  readonly ownerUserId: string;
  readonly payload: PlaceSubmissionPayload;
  /** The reviewer's override, or the payload's category. */
  readonly categoryCode: string;
  readonly triggerRadiusM: number;
  readonly narrationPriority: number;
  readonly now: Date;
}

/** A Venue's status as its owner's frame carries it (api-endpoints-plan §9). */
export interface OwnerPlaceFrame {
  readonly ownerUserId: string;
  readonly placeId: string;
  readonly status: PlaceStatus;
  readonly inactiveReason: PlaceInactiveReason | null;
}

/** A transaction's view of one Place: what it was, what it becomes, and what to publish. */
interface PlaceWrite {
  readonly place: LockedPlace;
  readonly before: PlaceVisibility;
  after: PlaceVisibility;
  observable: boolean;
}

/** The `content_hash` of a Place's source text (rdm-spec C-1). */
export const placeContentHash = (name: string, description: string) =>
  contentHash({ name, description });

/** The `content_hash` of a menu line (rdm-spec C-6). */
export const menuItemContentHash = (name: string, description: string | null | undefined) =>
  contentHash({ name, description: description ?? null });

const issue = (path: string, code = 'invalid_value') =>
  rpcError('VALIDATION_FAILED', { issues: [{ path, code }] });

const DELETED = 'DELETED';

// Widened: kinds are read from the database as plain strings.
const VENUE: string = PlaceKind.VENUE;
const ANY_KIND: string = CategoryAppliesTo.ANY;

/**
 * Staff administration of Places (api-endpoints-plan §3.5, rdm-spec §1.4, §1.6). Every write runs
 * in `withSyncWrite`: the business write, the audit event, any domain events, the one net
 * `status_changed`, and **last** the sync bump.
 */
@Injectable()
export class PlacesService {
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly uploads: UploadsService,
    private readonly billing: BillingPortService,
    private readonly ownerEntitlements: OwnerEntitlementsService,
    config: ConfigService<Env, true>,
    @Inject(SOCKET_EMITTER) private readonly frames: Pick<SocketEmitter, 'toRoom'>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  /** The console's Place table (api-endpoints-plan §3.5). */
  async listPlaces(
    request: catalogGrpc.ListPlacesRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ListPlacesResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const { page, pageSize, sort, q } = fields.page;
    const conditions: Prisma.Sql[] = [];
    if (!fields.includeDeleted) conditions.push(Prisma.sql`p.deleted_at IS NULL`);
    if (q !== undefined) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        Prisma.sql`(p.name_vi ILIKE ${pattern} ESCAPE '\\' OR p.public_code ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (fields.kind !== undefined) {
      const kind = placeKindProto.fromProto(fields.kind);
      if (kind === null || !PLACE_KINDS.includes(kind)) throw issue('/kind');
      conditions.push(Prisma.sql`p.kind = ${kind}`);
    }
    if (fields.status !== undefined) {
      const status = placeStatusProto.fromProto(fields.status);
      if (status === null || !PLACE_STATUSES.includes(status)) throw issue('/status');
      conditions.push(Prisma.sql`p.status = ${status}`);
    }
    if (fields.areaId !== undefined)
      conditions.push(Prisma.sql`p.area_id = ${fields.areaId}::uuid`);
    if (fields.categoryCode !== undefined) {
      conditions.push(
        Prisma.sql`p.category_id = (SELECT id FROM categories WHERE code = ${fields.categoryCode})`,
      );
    }
    if (fields.ownerUserId !== undefined) {
      conditions.push(Prisma.sql`p.owner_user_id = ${fields.ownerUserId}::uuid`);
    }
    const where =
      conditions.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const descending = sort.startsWith('-');
    const field = (descending ? sort.slice(1) : sort) as keyof typeof PLACE_SORT_COLUMNS;
    const direction = descending ? 'DESC' : 'ASC';
    // Both parts come from fixed tables above, never from the request.
    const orderBy = Prisma.raw(`p.${PLACE_SORT_COLUMNS[field]} ${direction}, p.id ${direction}`);

    const [counted, ids] = await Promise.all([
      this.prisma.$queryRaw<
        { total: number }[]
      >`SELECT count(*)::int AS total FROM places p ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM places p ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ]);
    const rows = await this.prisma.place.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: ADMIN_PLACE_LIST_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      places: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toAdminPlaceListItem(row, this.mediaBase)];
      }),
      page: { page, pageSize, total: counted[0]?.total ?? 0 },
    };
  }

  /** Every column, localization readiness, photos, menu and hours — deleted Places included. */
  async getPlaceAdmin(
    request: catalogGrpc.GetPlaceAdminRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetPlaceAdminResponse> {
    requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const exists = await this.prisma.place.count({ where: { id: placeId } });
    if (exists === 0) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    return { place: await this.view(this.prisma, placeId) };
  }

  /**
   * Creates an Editorial Place (api-endpoints-plan §3.5). Venues come from approved submissions.
   * `fixed` is the development seed's committed id and code (ADR 0002), never reachable over gRPC:
   * a committed code is tried once, and a collision is `SHORT_CODE_COLLISION`, never a new code.
   */
  async createEditorialPlace(
    request: catalogGrpc.CreateEditorialPlaceRequest,
    context: RequestContext,
    fixed: { readonly id?: string; readonly publicCode?: string } = {},
  ): Promise<catalogGrpc.CreateEditorialPlaceResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(createFields, request);
    fields.photos.forEach((item, index) => {
      if (item.uploadId === undefined) throw issue(`/photos/${index}/photoId`);
    });
    const text = fields.content;
    const now = new Date();
    const place = await withSyncWrite(this.prisma, async (tx) => {
      const category = await this.requireCategory(tx, text.categoryCode, PlaceKind.EDITORIAL);
      const area = await this.requireCoveringArea(tx, text.location);
      const id = fixed.id ?? newId();
      const status = fields.requestActivation ? PlaceStatus.PROCESSING : PlaceStatus.DRAFT;
      const hash = placeContentHash(text.nameVi, text.descriptionVi);
      const publicCode = await this.insertPlace(tx, {
        id,
        kind: PlaceKind.EDITORIAL,
        categoryId: category.id,
        areaId: area.id,
        text,
        contentHash: hash,
        triggerRadiusM: fields.triggerRadiusM,
        narrationPriority: fields.narrationPriority,
        status,
        activationRequestedAt: fields.requestActivation ? now : null,
        createdById: actor.userId,
        publicCode: fixed.publicCode,
      });
      await this.addPhotos(
        tx,
        id,
        actor.userId,
        fields.photos.map((item, index) => ({ ...item, sortOrder: index, index })),
        new Set(),
      );
      await this.writeHours(tx, id, fields.openingHours);
      await this.audit(tx, actor, AuditAction.PLACE_CREATED, id, now, {
        after: {
          kind: PlaceKind.EDITORIAL,
          status,
          categoryCode: text.categoryCode,
          areaCode: area.code,
          publicCode,
        },
      });
      if (fields.requestActivation) {
        await this.requestNarration(
          tx,
          id,
          PlaceKind.EDITORIAL,
          null,
          hash,
          SynthesisTrigger.APPROVAL,
          now,
        );
      }
      await bumpSyncVersion(tx, id);
      return this.view(tx, id);
    });
    return { place };
  }

  /**
   * Edits content fields. A changed source text sends a live Place back through `PROCESSING` and
   * asks narration again (rdm-spec §1.6); an edited Venue's owner is told.
   */
  async updatePlace(
    request: catalogGrpc.UpdatePlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.UpdatePlaceResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(updateFields, request);
    const now = new Date();
    const { placeId, ...change } = fields;
    const place = await this.write(placeId, (tx, write) =>
      this.applyContent(tx, write, actor, change, now, { notifyOwner: true }),
    );
    return { place };
  }

  /**
   * The content step, shared by an admin's edit and a submission's approval: a changed source text
   * sends a live Place back through `PROCESSING` and asks narration again (rdm-spec §1.6). An
   * approval does not tell the owner an admin edited their Venue: `SUBMISSION_APPROVED` does.
   */
  private async applyContent(
    tx: CatalogTx,
    write: PlaceWrite,
    actor: AccountContext,
    fields: ContentChange,
    now: Date,
    options: { readonly notifyOwner: boolean },
  ): Promise<void> {
    const current = write.place;
    const data: Prisma.PlaceUncheckedUpdateInput = {};
    const changed: string[] = [];
    const nameVi = fields.nameVi ?? current.nameVi;
    const descriptionVi = fields.descriptionVi ?? current.descriptionVi;
    if (nameVi !== current.nameVi) changed.push('nameVi');
    if (descriptionVi !== current.descriptionVi) changed.push('descriptionVi');

    if (fields.categoryCode !== undefined) {
      const category = await this.categoryForWrite(tx, fields.categoryCode, current);
      if (category.id !== current.categoryId) {
        data.categoryId = category.id;
        changed.push('categoryCode');
      }
    }
    let location: GeoPoint | null = null;
    if (
      fields.location !== undefined &&
      (fields.location.lat !== current.lat || fields.location.lng !== current.lng)
    ) {
      const area = await this.requireCoveringArea(tx, fields.location);
      location = fields.location;
      if (area.id !== current.areaId) data.areaId = area.id;
      changed.push('location');
    }
    const optional = [
      ['addressVi', fields.addressVi, current.addressVi],
      ['priceBand', fields.priceBand, current.priceBand],
      ['phone', fields.phone, current.phone],
      ['websiteUrl', fields.websiteUrl, current.websiteUrl],
    ] as const;
    for (const [key, next, previous] of optional) {
      if (next !== undefined && next !== previous) {
        (data as Record<string, unknown>)[key] = next;
        changed.push(key);
      }
    }
    if (changed.length === 0) return;

    const hash = placeContentHash(nameVi, descriptionVi);
    const contentChanged = hash !== current.contentHash;
    if (contentChanged) {
      Object.assign(data, { nameVi, descriptionVi, contentHash: hash });
      if (current.status === PlaceStatus.ACTIVE) {
        write.after = {
          ...write.after,
          status: transition(current.status, PlaceLifecycleEvent.SOURCE_CHANGED),
        };
        data.status = write.after.status;
      }
    }
    await tx.place.update({ where: { id: current.id }, data, select: { id: true } });
    if (location !== null) {
      // longitude first
      await tx.$executeRaw`
          UPDATE places
          SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography
          WHERE id = ${current.id}::uuid`;
    }
    await this.audit(tx, actor, AuditAction.PLACE_EDITED, current.id, now, {
      after: { changedFields: changed, contentChanged },
    });
    // A Draft has never been sent to narration; activation sends it.
    if (contentChanged && current.status !== PlaceStatus.DRAFT) {
      await this.requestNarration(
        tx,
        current.id,
        current.kind,
        current.ownerUserId,
        hash,
        SynthesisTrigger.CONTENT_CHANGED,
        now,
      );
    }
    if (options.notifyOwner && current.kind === PlaceKind.VENUE && current.ownerUserId !== null) {
      await this.outbox.add(tx, NOTIFICATION_CREATE, {
        occurredAt: now.toISOString(),
        recipientUserId: current.ownerUserId,
        notification: {
          type: NotificationType.PLACE_EDITED_BY_ADMIN,
          data: { placeId: current.id },
        },
      });
    }
    write.observable = true;
  }

  /** The editorial values — the only non-approval writer (rdm-spec §1.4). Never changes status. */
  async updateEditorial(
    request: catalogGrpc.UpdateEditorialRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.UpdateEditorialResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(editorialFields, request);
    const now = new Date();
    const { placeId, ...values } = fields;
    const place = await this.write(placeId, (tx, write) =>
      this.applyEditorial(tx, write, actor, values, now),
    );
    return { place };
  }

  /** The editorial step: the reviewer's or an admin's radius and priority, audited when changed. */
  private async applyEditorial(
    tx: CatalogTx,
    write: PlaceWrite,
    actor: AccountContext,
    fields: { readonly triggerRadiusM?: number; readonly narrationPriority?: number },
    now: Date,
  ): Promise<void> {
    const before = {
      triggerRadiusM: write.place.triggerRadiusM,
      narrationPriority: write.place.narrationPriority,
    };
    const after = {
      triggerRadiusM: fields.triggerRadiusM ?? before.triggerRadiusM,
      narrationPriority: fields.narrationPriority ?? before.narrationPriority,
    };
    if (
      after.triggerRadiusM === before.triggerRadiusM &&
      after.narrationPriority === before.narrationPriority
    ) {
      return;
    }
    await tx.place.update({ where: { id: write.place.id }, data: after, select: { id: true } });
    await this.audit(tx, actor, AuditAction.PLACE_EDITORIAL_UPDATED, write.place.id, now, {
      before,
      after,
    });
    write.observable = true;
  }

  /**
   * Replaces the ordered photo set. Kept photos keep their rows, new ones consume uploads, and the
   * removed rows' objects are listed for the cleanup job in the same transaction (rdm-spec C-17).
   */
  async replacePhotos(
    request: catalogGrpc.ReplacePhotosRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ReplacePhotosResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(photosFields, request);
    const now = new Date();
    const place = await this.write(fields.placeId, (tx, write) =>
      this.applyPhotos(tx, write, actor, fields.items, actor.userId, now),
    );
    return { place };
  }

  /**
   * The photo step: kept photos keep their rows, new ones consume uploads by `uploaderUserId` (the
   * owner, when an approval applies their submission), and the removed rows' objects are listed
   * for the cleanup job in the same transaction (rdm-spec C-17).
   */
  private async applyPhotos(
    tx: CatalogTx,
    write: PlaceWrite,
    actor: AccountContext,
    items: readonly PhotoSetItem[],
    uploaderUserId: string,
    now: Date,
    options: { readonly path?: string; readonly anyAge?: boolean } = {},
  ): Promise<void> {
    const placeId = write.place.id;
    const existing = await tx.placePhoto.findMany({
      where: { placeId },
      select: { id: true, originalSha256: true, variants: true },
    });
    const byId = new Map(existing.map((photo) => [photo.id, photo]));
    const kept = new Set<string>();
    const keptHashes = new Set<string>();
    const path = options.path ?? '/items';
    for (const [index, item] of items.entries()) {
      if (item.photoId === undefined) continue;
      const photo = byId.get(item.photoId);
      if (photo === undefined || kept.has(item.photoId)) throw issue(`${path}/${index}/photoId`);
      kept.add(item.photoId);
      keptHashes.add(photo.originalSha256);
    }
    const removed = existing.filter((photo) => !kept.has(photo.id));
    if (removed.length > 0) {
      await tx.placePhoto.deleteMany({ where: { id: { in: removed.map((photo) => photo.id) } } });
      await tx.orphanedObject.createMany({
        data: removed
          .flatMap((photo) => objectPathsOf(photo.variants))
          .map((objectPath) => ({
            objectPath,
          })),
        skipDuplicates: true,
      });
    }
    for (const [index, item] of items.entries()) {
      if (item.photoId === undefined) continue;
      await tx.placePhoto.update({
        where: { id: item.photoId },
        data: {
          sortOrder: index,
          ...(item.altTextVi === undefined ? {} : { altTextVi: item.altTextVi }),
        },
        select: { id: true },
      });
    }
    await this.addPhotos(
      tx,
      placeId,
      uploaderUserId,
      items.flatMap((item, index) =>
        item.uploadId === undefined ? [] : [{ ...item, sortOrder: index, index }],
      ),
      keptHashes,
      { path, anyAge: options.anyAge === true },
    );
    await this.audit(tx, actor, AuditAction.PLACE_PHOTOS_REPLACED, placeId, now, {
      after: { photoCount: items.length },
    });
    write.observable = true;
  }

  /** Replaces a Venue's menu (rdm-spec C-6, ADR 0046); unchanged lines keep their translations. */
  async replaceMenu(
    request: catalogGrpc.ReplaceMenuRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ReplaceMenuResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(menuFields, request);
    const menuCurrency = menuCurrencyProto.fromProto(fields.menuCurrency);
    if (menuCurrency === null) throw issue('/menuCurrency');
    const menu: MenuInput = parseRpcRequest(zMenuInput, { menuCurrency, items: fields.items });
    const now = new Date();
    const place = await this.write(fields.placeId, (tx, write) =>
      this.applyMenu(tx, write, actor, menu, now),
    );
    return { place };
  }

  /** The menu step: unchanged lines keep their translations; new ones ask narration (rdm-spec C-6). */
  private async applyMenu(
    tx: CatalogTx,
    write: PlaceWrite,
    actor: AccountContext,
    menu: MenuInput,
    now: Date,
  ): Promise<void> {
    const current = write.place;
    // A landmark has no menu.
    if (current.kind !== PlaceKind.VENUE) {
      throw rpcError('INVALID_STATE', { status: PlaceKind.EDITORIAL });
    }
    const existing = await tx.menuItem.findMany({
      where: { placeId: current.id },
      select: { id: true, contentHash: true },
    });
    const unused = new Map<string, string[]>();
    for (const item of existing) {
      unused.set(item.contentHash, [...(unused.get(item.contentHash) ?? []), item.id]);
    }
    const keptIds = new Set<string>();
    const created: string[] = [];
    const rows = menu.items.map((item, index) => {
      const hash = menuItemContentHash(item.nameVi, item.descriptionVi);
      const reuse = unused.get(hash)?.shift();
      if (reuse !== undefined) keptIds.add(reuse);
      return { item, index, hash, id: reuse ?? newId(), reused: reuse !== undefined };
    });
    await tx.menuItem.deleteMany({
      where: { placeId: current.id, id: { notIn: [...keptIds] } },
    });
    for (const row of rows) {
      const data = {
        nameVi: row.item.nameVi,
        descriptionVi: row.item.descriptionVi ?? null,
        priceMinor: row.item.priceMinor ?? null,
        isAvailable: row.item.isAvailable,
        sortOrder: row.index,
        contentHash: row.hash,
      };
      if (row.reused) {
        await tx.menuItem.update({ where: { id: row.id }, data, select: { id: true } });
      } else {
        await tx.menuItem.create({
          data: { id: row.id, placeId: current.id, ...data },
          select: { id: true },
        });
        created.push(row.id);
      }
    }
    await tx.place.update({
      where: { id: current.id },
      data: { menuCurrency: menu.menuCurrency },
      select: { id: true },
    });
    await this.audit(tx, actor, AuditAction.PLACE_MENU_REPLACED, current.id, now, {
      after: { itemCount: menu.items.length, menuCurrency: menu.menuCurrency },
    });
    if (created.length > 0) {
      await this.outbox.add(tx, CATALOG_MENU_CONTENT_CHANGED, {
        occurredAt: now.toISOString(),
        placeId: current.id,
        menuItemIds: created,
        langs: [...(await this.languagesFor(tx, current.kind, current.ownerUserId))],
      });
    }
    write.observable = true;
  }

  /** Replaces the opening hours (rdm-spec C-16). */
  async replaceOpeningHours(
    request: catalogGrpc.ReplaceOpeningHoursRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ReplaceOpeningHoursResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(hoursFields, request);
    const now = new Date();
    const place = await this.write(fields.placeId, (tx, write) =>
      this.applyHours(tx, write, actor, fields.rows, now),
    );
    return { place };
  }

  /** The opening-hours step: the whole list replaced (rdm-spec C-16). */
  private async applyHours(
    tx: CatalogTx,
    write: PlaceWrite,
    actor: AccountContext,
    rows: readonly OpeningHoursRow[],
    now: Date,
  ): Promise<void> {
    await tx.placeOpeningHours.deleteMany({ where: { placeId: write.place.id } });
    await this.writeHours(tx, write.place.id, rows);
    await this.audit(tx, actor, AuditAction.PLACE_HOURS_REPLACED, write.place.id, now, {
      after: { rowCount: rows.length },
    });
    write.observable = true;
  }

  /**
   * Asks for publication and evaluates the gate (api-endpoints-plan §3.5) — never a silent no-op:
   * the answer says what is still missing. A Draft is sent to narration for the first time.
   */
  async requestActivation(
    request: catalogGrpc.RequestActivationRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RequestActivationResponse> {
    const actor = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const now = new Date();
    let missing: GateMissing[] = [];
    let status: PlaceStatus = PlaceStatus.ACTIVE;
    await this.write(placeId, async (tx, write) => {
      const current = write.place;
      if (current.status === PlaceStatus.ACTIVE) return;
      // Only an admin's own deactivation is an admin's to undo (rdm-spec C-1).
      if (
        current.status === PlaceStatus.INACTIVE &&
        current.inactiveReason !== PlaceInactiveReason.ADMIN
      ) {
        throw rpcError('INVALID_STATE', { status: current.status });
      }
      await this.requireActiveArea(tx, current.areaId);
      status =
        current.status === PlaceStatus.PROCESSING
          ? current.status
          : transition(current.status, PlaceLifecycleEvent.ACTIVATION_REQUESTED);
      await tx.place.update({
        where: { id: current.id },
        data: { status, inactiveReason: null, activationRequestedAt: now },
        select: { id: true },
      });
      if (current.status === PlaceStatus.DRAFT) {
        await this.requestNarration(
          tx,
          current.id,
          current.kind,
          current.ownerUserId,
          current.contentHash,
          SynthesisTrigger.APPROVAL,
          now,
        );
      }
      const opened = await this.openGateIfReady(tx, current.id, {
        contentHash: current.contentHash,
        activationRequestedAt: now,
        publishedAt: current.publishedAt,
      });
      missing = opened.missing;
      if (opened.open) status = PlaceStatus.ACTIVE;
      await this.audit(tx, actor, AuditAction.PLACE_ACTIVATION_REQUESTED, current.id, now, {
        after: { status, missing },
      });
      if (opened.open) {
        await this.audit(tx, actor, AuditAction.PLACE_ACTIVATED, current.id, now);
      }
      write.after = { ...write.after, status };
      write.observable = true;
    });
    return { status: placeStatusProto.toProto(status), missing };
  }

  /** Takes a live or processing Place offline (rdm-spec §1.6). */
  async deactivatePlace(
    request: catalogGrpc.DeactivatePlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.DeactivatePlaceResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(deactivateFields, request);
    const now = new Date();
    const place = await this.write(fields.placeId, async (tx, write) => {
      const current = write.place;
      const status = transition(current.status, PlaceLifecycleEvent.DEACTIVATED);
      await tx.place.update({
        where: { id: current.id },
        data: { status, inactiveReason: PlaceInactiveReason.ADMIN },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.PLACE_DEACTIVATED, current.id, now, {
        before: { status: current.status },
        reason: fields.reason,
      });
      write.after = { ...write.after, status };
      write.observable = true;
    });
    return { place };
  }

  /**
   * Soft-deletes a Place; the bumped row is the sync tombstone (rdm-spec §1.7). A Venue asks billing
   * first, and an unreachable billing refuses (api-endpoints-plan §12.2).
   */
  async deletePlace(
    request: catalogGrpc.DeletePlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.DeletePlaceResponse> {
    const actor = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const found = await this.prisma.place.findUnique({
      where: { id: placeId },
      select: { kind: true, deletedAt: true },
    });
    if (found === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    if (found.deletedAt !== null) throw rpcError('INVALID_STATE', { status: DELETED });
    // An Editorial Place cannot have offers; tours are checked once they exist.
    if (found.kind === VENUE) {
      const vouchers = await this.billing.countLiveVouchers(placeId);
      if (vouchers > 0) throw rpcError('PLACE_HAS_LIVE_VOUCHERS');
    }
    const now = new Date();
    await this.write(placeId, async (tx, write) => {
      await tx.place.update({
        where: { id: placeId },
        data: { deletedAt: now, deletedById: actor.userId },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.PLACE_DELETED, placeId, now, {
        before: { status: write.place.status },
      });
      write.after = { ...write.after, deleted: true };
      write.observable = true;
    });
    return {};
  }

  /** Restores a deleted Place with its status; its localizations were kept, so its gate holds. */
  async restorePlace(
    request: catalogGrpc.RestorePlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RestorePlaceResponse> {
    const actor = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const now = new Date();
    const place = await this.write(
      placeId,
      async (tx, write) => {
        if (write.place.deletedAt === null) {
          throw rpcError('INVALID_STATE', { status: write.place.status });
        }
        await this.requireActiveArea(tx, write.place.areaId);
        await tx.place.update({
          where: { id: placeId },
          data: { deletedAt: null, deletedById: null },
          select: { id: true },
        });
        await this.audit(tx, actor, AuditAction.PLACE_RESTORED, placeId, now, {
          before: { status: write.place.status },
        });
        write.after = { ...write.after, deleted: false };
        write.observable = true;
      },
      { allowDeleted: true },
    );
    return { place };
  }

  /**
   * The sticker (api-endpoints-plan §3.5): an SVG QR of `<qrBaseUrl>/q/<code>` with the code
   * printed beneath. The base comes from the gateway; catalog holds no public URL.
   */
  async getPlaceQr(
    request: catalogGrpc.GetPlaceQrRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetPlaceQrResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(qrFields, request);
    const place = await this.prisma.place.findUnique({
      where: { id: fields.placeId },
      select: { publicCode: true },
    });
    if (place === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    const url = `${fields.qrBaseUrl}/q/${place.publicCode}`;
    return { svg: await stickerSvg(url, place.publicCode), publicCode: place.publicCode };
  }

  /**
   * An owner's Venues follow their grants (api-endpoints-plan §10, rdm-spec B-3): auto-narration,
   * the place limit both ways, and narration for newly covered languages. An event whose version
   * is not newer than the projection's is ignored; each effect is idempotent, and the projection is
   * written last, so a redelivery after a crash finishes the work.
   */
  async applyEntitlements(event: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>): Promise<void> {
    const known = await this.ownerEntitlements.current(this.prisma, event.ownerUserId);
    if (known !== null && event.entitlementsVersion <= known.version) return;
    const next = event.entitlements;
    const previousScope = known?.narrationLanguageScope ?? event.previous?.narrationLanguageScope;
    const now = new Date();
    await this.setAutoNarration(event.ownerUserId, next.autoNarration);
    await this.enforcePlaceLimit(event.ownerUserId, effectiveLimit('maxPlaces', next), now);
    if (previousScope !== undefined && scopeWidened(previousScope, next.narrationLanguageScope)) {
      const had = new Set<string>(scopeLanguages(previousScope));
      const added = scopeLanguages(next.narrationLanguageScope).filter((lang) => !had.has(lang));
      await this.requestEntitledLanguages(event.ownerUserId, added, now);
    }
    await this.ownerEntitlements.record(this.prisma, event);
  }

  /**
   * An erased owner's Venues (api-endpoints-plan §10, rdm-spec C-1): a Venue nobody can manage stops
   * narrating. A published one, or one waiting on the plan or on an admin, goes `INACTIVE (OWNER)`,
   * which no route lifts, so a later grant cannot bring it back; a draft, which cannot become
   * `INACTIVE` and was never public, is soft-deleted. The rows are business data and are kept.
   * Each step is idempotent; the event is recorded last, so a redelivery after a crash finishes.
   */
  async retireErasedOwner(
    event: EventPayload<typeof IDENTITY_USER_ERASED>,
    consumer: string,
  ): Promise<void> {
    const done = await this.prisma.processedEvent.findUnique({
      where: { consumer_eventId: { consumer, eventId: event.eventId } },
      select: { eventId: true },
    });
    if (done !== null) return;
    const now = new Date();
    const venues = await this.prisma.place.findMany({
      where: { ownerUserId: event.userId, kind: VENUE, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    for (const { id } of venues) {
      await this.write(id, (tx, write) => this.retireForErasure(tx, write, now), {
        allowDeleted: true,
      });
    }
    // A pending submission of an erased owner can never be approved, and holds their contact phone.
    await this.prisma.$transaction(async (tx) => {
      const withdrawn = await tx.$queryRaw<{ id: string }[]>`
        UPDATE place_submissions
        SET status = ${SubmissionStatus.WITHDRAWN}, updated_at = now()
        WHERE owner_user_id = ${event.userId}::uuid AND status = ${SubmissionStatus.PENDING}
        RETURNING id`;
      for (const { id } of withdrawn) {
        await this.outbox.add(
          tx,
          AUDIT_RECORD,
          submissionAuditRecord({
            actor: { type: AuditActorType.SYSTEM },
            action: AuditAction.SUBMISSION_WITHDRAWN,
            submissionId: id,
            metadata: { before: { status: SubmissionStatus.PENDING } },
            origin: { ip: null, userAgent: null },
            now,
          }),
        );
      }
    });
    await this.prisma.processedEvent.createMany({
      data: [{ consumer, eventId: event.eventId }],
      skipDuplicates: true,
    });
  }

  /** One Venue of an erased owner: soft-deleted as a draft, `INACTIVE (OWNER)` otherwise. */
  private async retireForErasure(tx: CatalogTx, write: PlaceWrite, now: Date): Promise<void> {
    const current = write.place;
    if (current.deletedAt !== null) return;
    if (current.status === PlaceStatus.DRAFT) {
      await tx.place.update({
        where: { id: current.id },
        data: { deletedAt: now },
        select: { id: true },
      });
      await this.systemAudit(tx, AuditAction.PLACE_DELETED, current.id, now, {
        before: { status: current.status },
      });
      write.after = { ...write.after, deleted: true };
      write.observable = true;
      return;
    }
    if (current.status === PlaceStatus.INACTIVE) {
      if (current.inactiveReason === PlaceInactiveReason.OWNER) return;
      await tx.place.update({
        where: { id: current.id },
        data: { inactiveReason: PlaceInactiveReason.OWNER },
        select: { id: true },
      });
    } else {
      const status = transition(current.status, PlaceLifecycleEvent.DEACTIVATED);
      await tx.place.update({
        where: { id: current.id },
        data: { status, inactiveReason: PlaceInactiveReason.OWNER },
        select: { id: true },
      });
      write.after = { ...write.after, status };
      write.observable = true;
    }
    await this.systemAudit(tx, AuditAction.PLACE_DEACTIVATED, current.id, now, {
      before: { status: current.status },
      reason: PlaceInactiveReason.OWNER,
    });
  }

  /** Sets `auto_narration_enabled` on every Venue of the owner that differs, bumping each. */
  private async setAutoNarration(ownerUserId: string, enabled: boolean): Promise<void> {
    const differing = await this.prisma.place.findMany({
      where: { ownerUserId, kind: VENUE, autoNarrationEnabled: !enabled },
      select: { id: true },
    });
    for (const { id } of differing) {
      await withSyncWrite(this.prisma, async (tx) => {
        await tx.place.update({
          where: { id },
          data: { autoNarrationEnabled: enabled },
          select: { id: true },
        });
        await bumpSyncVersion(tx, id);
      });
    }
  }

  /**
   * The place limit (rdm-spec B-3, C-1): the oldest `maxPlaces` counted Venues stay; a live one
   * beyond them is unpublished (`ENTITLEMENT_LIMIT`), newest first. With room to spare,
   * `ENTITLEMENT_LIMIT` Venues come back, oldest first, up to the room. A Draft counts but is never
   * unpublished — it was never published.
   */
  private async enforcePlaceLimit(
    ownerUserId: string,
    maxPlaces: number,
    now: Date,
  ): Promise<void> {
    const counted = await this.prisma.place.findMany({
      where: {
        ownerUserId,
        kind: VENUE,
        deletedAt: null,
        status: { in: [...PLACE_LIMIT_STATUSES] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true },
    });
    if (counted.length > maxPlaces) {
      const beyond = counted.slice(maxPlaces).reverse();
      for (const place of beyond) {
        if (place.status === String(PlaceStatus.DRAFT)) continue;
        await this.write(place.id, (tx, write) => this.unpublishForEntitlement(tx, write, now));
      }
      return;
    }
    const room = maxPlaces - counted.length;
    if (room === 0) return;
    const waiting = await this.prisma.place.findMany({
      where: {
        ownerUserId,
        kind: VENUE,
        deletedAt: null,
        status: PlaceStatus.INACTIVE,
        inactiveReason: PlaceInactiveReason.ENTITLEMENT_LIMIT,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: room,
      select: { id: true },
    });
    for (const { id } of waiting) {
      await this.write(id, (tx, write) => this.activateAfterEntitlement(tx, write, now));
    }
  }

  /** A live Venue over the limit goes `INACTIVE (ENTITLEMENT_LIMIT)`, audited as catalog's own act. */
  private async unpublishForEntitlement(
    tx: CatalogTx,
    write: PlaceWrite,
    now: Date,
  ): Promise<void> {
    const current = write.place;
    if (current.status !== PlaceStatus.ACTIVE && current.status !== PlaceStatus.PROCESSING) return;
    const status = transition(current.status, PlaceLifecycleEvent.DEACTIVATED);
    await tx.place.update({
      where: { id: current.id },
      data: { status, inactiveReason: PlaceInactiveReason.ENTITLEMENT_LIMIT },
      select: { id: true },
    });
    await this.systemAudit(tx, AuditAction.PLACE_DEACTIVATED, current.id, now, {
      before: { status: current.status },
      reason: PlaceInactiveReason.ENTITLEMENT_LIMIT,
    });
    write.after = { ...write.after, status };
    write.observable = true;
  }

  /**
   * catalog's system activation path: `INACTIVE (ENTITLEMENT_LIMIT)` goes through the same gate
   * `requestActivation` uses, audited as catalog's own act. The owner- and admin-facing
   * `requestActivation` keeps refusing it — only a wider plan lifts this reason.
   */
  private async activateAfterEntitlement(
    tx: CatalogTx,
    write: PlaceWrite,
    now: Date,
  ): Promise<void> {
    const current = write.place;
    if (
      current.status !== PlaceStatus.INACTIVE ||
      current.inactiveReason !== PlaceInactiveReason.ENTITLEMENT_LIMIT
    ) {
      return;
    }
    let status = transition(current.status, PlaceLifecycleEvent.ACTIVATION_REQUESTED);
    await tx.place.update({
      where: { id: current.id },
      data: { status, inactiveReason: null, activationRequestedAt: now },
      select: { id: true },
    });
    const opened = await this.openGateIfReady(tx, current.id, {
      contentHash: current.contentHash,
      activationRequestedAt: now,
      publishedAt: current.publishedAt,
    });
    if (opened.open) status = PlaceStatus.ACTIVE;
    await this.systemAudit(tx, AuditAction.PLACE_ACTIVATION_REQUESTED, current.id, now, {
      after: { status, missing: opened.missing },
    });
    if (opened.open) await this.systemAudit(tx, AuditAction.PLACE_ACTIVATED, current.id, now);
    write.after = { ...write.after, status };
    write.observable = true;
  }

  /** Asks narration for newly covered languages of every published Venue of the owner. */
  private async requestEntitledLanguages(
    ownerUserId: string,
    langs: readonly Language[],
    now: Date,
  ): Promise<void> {
    if (langs.length === 0) return;
    const venues = await this.prisma.place.findMany({
      where: { ownerUserId, kind: VENUE, deletedAt: null, status: { not: PlaceStatus.DRAFT } },
      select: { id: true, contentHash: true },
    });
    for (const venue of venues) {
      await this.prisma.$transaction((tx) =>
        this.outbox.add(tx, CATALOG_PLACE_CONTENT_CHANGED, {
          occurredAt: now.toISOString(),
          placeId: venue.id,
          contentHash: venue.contentHash,
          langs: [...langs],
          trigger: SynthesisTrigger.ENTITLEMENT_EXPANDED,
        }),
      );
    }
  }

  /**
   * Runs a write on a locked Place in `withSyncWrite`, then publishes the one net status change and
   * bumps the version if anything observable happened. Maps a refused transition to `INVALID_STATE`.
   */
  private async write(
    placeId: string,
    apply: (tx: CatalogTx, write: PlaceWrite) => Promise<void>,
    options: { allowDeleted?: boolean } = {},
  ): Promise<catalogGrpc.AdminPlace> {
    try {
      const { view, frame } = await withSyncWrite(this.prisma, (tx) =>
        this.writeInTx(tx, placeId, apply, options),
      );
      if (frame !== null) this.announceStatus(frame);
      return view;
    } catch (error) {
      if (isIllegalTransition(error)) throw rpcError('INVALID_STATE', { status: error.from });
      throw error;
    }
  }

  /**
   * `write` inside the caller's transaction: locks the Place, applies, publishes the one net
   * status change and bumps the version. Returns the view and the owner's frame, which is sent
   * only after the commit.
   */
  private async writeInTx(
    tx: CatalogTx,
    placeId: string,
    apply: (tx: CatalogTx, write: PlaceWrite) => Promise<void>,
    options: { allowDeleted?: boolean } = {},
  ): Promise<{ view: catalogGrpc.AdminPlace; frame: OwnerPlaceFrame | null }> {
    const place = await this.lock(tx, placeId);
    if (place.deletedAt !== null && options.allowDeleted !== true) {
      throw rpcError('INVALID_STATE', { status: DELETED });
    }
    const before = { status: place.status, deleted: place.deletedAt !== null };
    const write: PlaceWrite = { place, before, after: before, observable: false };
    await apply(tx, write);
    const change = netVisibilityChange(write.before, write.after);
    let frame: OwnerPlaceFrame | null = null;
    if (change !== null) {
      // A first publication is the one that stamped `published_at` in this transaction.
      const firstPublication =
        place.publishedAt === null &&
        (
          await tx.place.findUniqueOrThrow({
            where: { id: placeId },
            select: { publishedAt: true },
          })
        ).publishedAt !== null;
      const reason =
        change.to === PlaceStatus.INACTIVE ? await this.inactiveReason(tx, placeId) : null;
      await this.outbox.add(tx, CATALOG_PLACE_STATUS_CHANGED, {
        occurredAt: new Date().toISOString(),
        placeId,
        ...change,
        reason,
        ...(place.ownerUserId === null ? {} : { ownerUserId: place.ownerUserId }),
        firstPublication,
      });
      if (place.ownerUserId !== null && !change.deleted) {
        frame = {
          ownerUserId: place.ownerUserId,
          placeId,
          status: change.to,
          inactiveReason: reason,
        };
      }
    }
    if (write.observable) await bumpSyncVersion(tx, placeId);
    return { view: await this.view(tx, placeId), frame };
  }

  /**
   * Serializes everything that counts an owner's place limit (rdm-spec C-1, C-11): two
   * submissions, approvals or reactivations cannot both take the last slot.
   */
  async lockOwner(tx: CatalogTx, ownerUserId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog:owner:${ownerUserId}`}))`;
  }

  /**
   * What counts against `max_places` (rdm-spec C-1): the owner's Venues in `PLACE_LIMIT_STATUSES`,
   * and their `PENDING` creations, which reserve a slot. Count under `lockOwner`.
   */
  async placeLimitUsage(
    db: CatalogTx,
    ownerUserId: string,
  ): Promise<{ used: number; reserved: number }> {
    const [used, reserved] = await Promise.all([
      db.place.count({
        where: {
          ownerUserId,
          kind: VENUE,
          deletedAt: null,
          status: { in: [...PLACE_LIMIT_STATUSES] },
        },
      }),
      db.placeSubmission.count({
        where: {
          ownerUserId,
          kind: SubmissionKind.CREATE,
          status: SubmissionStatus.PENDING,
        },
      }),
    ]);
    return { used, reserved };
  }

  /** A Venue of this owner, not deleted; anything else is `404 PLACE` to them. */
  async ownedVenue(db: CatalogTx, placeId: string, ownerUserId: string): Promise<AdminPlaceView> {
    const found = await db.place.findUnique({
      where: { id: placeId },
      select: { kind: true, ownerUserId: true, deletedAt: true },
    });
    if (found?.kind !== VENUE || found.ownerUserId !== ownerUserId || found.deletedAt !== null) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    }
    return this.view(db, placeId);
  }

  /** A Place as catalog's admin view shows it (the owner's detail uses the same shape). */
  async placeView(db: CatalogTx, placeId: string): Promise<AdminPlaceView> {
    return this.view(db, placeId);
  }

  /**
   * What a submission names, checked as submission and approval both need it (api-endpoints-plan
   * §3.3): a Venue category, a location inside an active area, the caller's own confirmed uploads,
   * and photos of this Place. Paths are the payload's.
   */
  async checkSubmissionPayload(
    tx: CatalogTx,
    payload: PlaceSubmissionPayload,
    target: { readonly ownerUserId: string; readonly placeId: string | null },
  ): Promise<void> {
    // An edit's unchanged category and location are the Place's own, and are not checked again
    // (rdm-spec C-1): retiring a category or an area never blocks an edit of a Place that has it.
    const [current] =
      target.placeId === null
        ? []
        : await tx.$queryRaw<{ categoryId: string; lat: number; lng: number }[]>`
            SELECT category_id AS "categoryId",
                   ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
            FROM places WHERE id = ${target.placeId}::uuid`;
    if (current === undefined) {
      await this.requireCategory(tx, payload.categoryCode, PlaceKind.VENUE);
      await this.requireCoveringArea(tx, payload.location);
    } else {
      await this.categoryForWrite(tx, payload.categoryCode, {
        kind: PlaceKind.VENUE,
        categoryId: current.categoryId,
      });
      if (payload.location.lat !== current.lat || payload.location.lng !== current.lng) {
        await this.requireCoveringArea(tx, payload.location);
      }
    }
    const photoIds = new Set(
      target.placeId === null
        ? []
        : (
            await tx.placePhoto.findMany({
              where: { placeId: target.placeId },
              select: { id: true },
            })
          ).map((photo) => photo.id),
    );
    for (const [index, photo] of payload.photos.entries()) {
      if (photo.photoId !== undefined) {
        if (!photoIds.has(photo.photoId)) throw issue(`/payload/photos/${index}/photoId`);
        continue;
      }
      const upload = await tx.pendingUpload.findUnique({
        where: { id: photo.uploadId! },
        select: { uploaderUserId: true, confirmedAt: true, consumedAt: true },
      });
      if (upload?.uploaderUserId !== target.ownerUserId) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: 'UPLOAD' });
      }
      if (upload.confirmedAt === null || upload.consumedAt !== null) {
        throw rpcError('UPLOAD_NOT_READY');
      }
    }
  }

  /**
   * Approves a `CREATE` (rdm-spec C-11) in one transaction: `prepare` takes the owner lock, moves the
   * submission and re-counts the limit; then the Venue is inserted with the reviewer's editorial
   * values and the owner's plan's auto-narration, its photos, menu and hours written through the
   * ordinary steps, narration requested in the owner's scope, and `record` closes the submission.
   */
  async approveCreate(
    approval: SubmissionApproval,
    hooks: {
      readonly prepare: (tx: CatalogTx) => Promise<void>;
      readonly record: (tx: CatalogTx, placeId: string) => Promise<void>;
    },
    fixed: FixedPlace = {},
  ): Promise<AdminPlaceView> {
    const { payload, reviewer, ownerUserId, now } = approval;
    try {
      const { view, frame } = await withSyncWrite(this.prisma, async (tx) => {
        await hooks.prepare(tx);
        const category = await this.requireCategory(tx, approval.categoryCode, PlaceKind.VENUE);
        const area = await this.requireCoveringArea(tx, payload.location);
        const id = fixed.id ?? newId();
        const hash = placeContentHash(payload.nameVi, payload.descriptionVi);
        const publicCode = await this.insertPlace(tx, {
          publicCode: fixed.publicCode,
          id,
          kind: PlaceKind.VENUE,
          categoryId: category.id,
          areaId: area.id,
          text: { ...contentOf(payload), categoryCode: approval.categoryCode },
          contentHash: hash,
          triggerRadiusM: approval.triggerRadiusM,
          narrationPriority: approval.narrationPriority,
          status: PlaceStatus.PROCESSING,
          activationRequestedAt: now,
          createdById: reviewer.userId,
          ownerUserId,
          autoNarrationEnabled: await this.ownerEntitlements.autoNarrationOf(tx, ownerUserId),
        });
        await this.audit(tx, reviewer, AuditAction.PLACE_CREATED, id, now, {
          after: {
            kind: PlaceKind.VENUE,
            status: PlaceStatus.PROCESSING,
            categoryCode: approval.categoryCode,
            areaCode: area.code,
            publicCode,
          },
        });
        const written = await this.writeInTx(tx, id, async (inner, write) => {
          await this.applyPhotos(inner, write, reviewer, payload.photos, ownerUserId, now, {
            path: '/payload/photos',
            anyAge: true,
          });
          await this.applyMenu(inner, write, reviewer, payload.menu, now);
          await this.applyHours(inner, write, reviewer, payload.openingHours, now);
        });
        await this.requestNarration(
          tx,
          id,
          PlaceKind.VENUE,
          ownerUserId,
          hash,
          SynthesisTrigger.APPROVAL,
          now,
        );
        await hooks.record(tx, id);
        const created: OwnerPlaceFrame = {
          ownerUserId,
          placeId: id,
          status: PlaceStatus.PROCESSING,
          inactiveReason: null,
        };
        return { view: written.view, frame: created };
      });
      this.announceStatus(frame);
      return view;
    } catch (error) {
      if (isIllegalTransition(error)) throw rpcError('INVALID_STATE', { status: error.from });
      throw error;
    }
  }

  /**
   * Approves an `UPDATE` (rdm-spec C-11) in one transaction on the locked Venue: `prepare` moves the
   * submission, `check` sees the live editable fields (the conflict), then the whole payload goes
   * through the ordinary steps with the reviewer's editorial values — a text change sends a live
   * Venue back through `PROCESSING`; an `INACTIVE` one stays so. The owner is not told an admin
   * edited their Venue: the submission's outcome tells them.
   */
  async approveUpdate(
    placeId: string,
    approval: SubmissionApproval,
    hooks: {
      readonly prepare: (tx: CatalogTx) => Promise<void>;
      readonly check: (live: EditableSnapshot) => void;
      readonly record: (tx: CatalogTx) => Promise<void>;
    },
  ): Promise<AdminPlaceView> {
    const { payload, reviewer, now } = approval;
    return this.write(placeId, async (tx, write) => {
      const current = write.place;
      if (current.kind !== PlaceKind.VENUE || current.ownerUserId !== approval.ownerUserId) {
        throw rpcError('INVALID_STATE', { status: 'OWNER_CHANGED' });
      }
      await hooks.prepare(tx);
      hooks.check(snapshotOfPlace(await this.view(tx, placeId)));
      await this.applyContent(
        tx,
        write,
        reviewer,
        { ...contentOf(payload), categoryCode: approval.categoryCode },
        now,
        { notifyOwner: false },
      );
      await this.applyEditorial(
        tx,
        write,
        reviewer,
        { triggerRadiusM: approval.triggerRadiusM, narrationPriority: approval.narrationPriority },
        now,
      );
      await this.applyPhotos(tx, write, reviewer, payload.photos, approval.ownerUserId, now, {
        path: '/payload/photos',
        anyAge: true,
      });
      await this.applyMenu(tx, write, reviewer, payload.menu, now);
      await this.applyHours(tx, write, reviewer, payload.openingHours, now);
      await hooks.record(tx);
    });
  }

  /**
   * `POST /owner/places/:id/deactivate` (api-endpoints-plan §3.1): an `ACTIVE` Venue goes
   * `INACTIVE (OWNER)` — closed for renovation, the listing kept. Any other state is refused.
   */
  async deactivateByOwner(placeId: string, owner: AccountContext): Promise<AdminPlaceView> {
    const now = new Date();
    return this.write(
      placeId,
      async (tx, write) => {
        const current = write.place;
        requireOwned(current, owner.userId);
        if (current.status !== PlaceStatus.ACTIVE) {
          throw rpcError('INVALID_STATE', { status: current.status });
        }
        const status = transition(current.status, PlaceLifecycleEvent.DEACTIVATED);
        await tx.place.update({
          where: { id: current.id },
          data: { status, inactiveReason: PlaceInactiveReason.OWNER },
          select: { id: true },
        });
        await this.audit(tx, owner, AuditAction.PLACE_DEACTIVATED_BY_OWNER, current.id, now, {
          before: { status: current.status, inactiveReason: null },
          after: { status, inactiveReason: PlaceInactiveReason.OWNER },
        });
        write.after = { ...write.after, status };
        write.observable = true;
      },
      { allowDeleted: true },
    );
  }

  /**
   * `POST /owner/places/:id/reactivate` (api-endpoints-plan §3.1): `INACTIVE (OWNER)` or
   * `INACTIVE (ENTITLEMENT_LIMIT)` back through the activation gate, when the plan has room — the
   * Venue itself does not count yet. An admin's deactivation is an admin's to undo.
   */
  async reactivateByOwner(
    placeId: string,
    owner: AccountContext,
    maxPlaces: number,
  ): Promise<AdminPlaceView> {
    const now = new Date();
    return this.write(
      placeId,
      async (tx, write) => {
        const current = write.place;
        requireOwned(current, owner.userId);
        const reason = current.inactiveReason;
        if (
          current.status !== PlaceStatus.INACTIVE ||
          (reason !== PlaceInactiveReason.OWNER && reason !== PlaceInactiveReason.ENTITLEMENT_LIMIT)
        ) {
          throw rpcError('INVALID_STATE', { status: current.status });
        }
        // The owner lock first, the areas lock second: the order every Venue write takes them in.
        await this.lockOwner(tx, owner.userId);
        await this.requireActiveArea(tx, current.areaId);
        const usage = await this.placeLimitUsage(tx, owner.userId);
        if (usage.used + usage.reserved >= maxPlaces) {
          throw rpcError('PLACE_LIMIT_REACHED', { limit: maxPlaces });
        }
        let status = transition(current.status, PlaceLifecycleEvent.ACTIVATION_REQUESTED);
        await tx.place.update({
          where: { id: current.id },
          data: { status, inactiveReason: null, activationRequestedAt: now },
          select: { id: true },
        });
        const opened = await this.openGateIfReady(tx, current.id, {
          contentHash: current.contentHash,
          activationRequestedAt: now,
          publishedAt: current.publishedAt,
        });
        if (opened.open) status = PlaceStatus.ACTIVE;
        await this.audit(tx, owner, AuditAction.PLACE_REACTIVATED, current.id, now, {
          before: { status: current.status, inactiveReason: reason },
          after: { status, inactiveReason: null },
        });
        if (opened.open) await this.audit(tx, owner, AuditAction.PLACE_ACTIVATED, current.id, now);
        write.after = { ...write.after, status };
        write.observable = true;
      },
      { allowDeleted: true },
    );
  }

  /**
   * `owner:place:status` to the owner's room (api-endpoints-plan §9), after the commit that changed
   * a Venue's status — the one hook every status path goes through, the localization consumer's
   * gate included. Fire-and-forget: the feed and the Venue list are the record.
   */
  announceStatus(frame: OwnerPlaceFrame): void {
    this.frames.toRoom(SOCKET_ROOMS.owner(frame.ownerUserId), 'ownerPlaceStatus', {
      placeId: frame.placeId,
      status: frame.status,
      inactiveReason: frame.inactiveReason,
    });
  }

  /**
   * Opens the gate when it is ready (rdm-spec §1.6), moving `PROCESSING` → `ACTIVE` and stamping
   * the first publication. Shared with the localization consumer.
   */
  async openGateIfReady(
    tx: CatalogTx,
    placeId: string,
    place: { contentHash: string; activationRequestedAt: Date | null; publishedAt: Date | null },
  ): Promise<{ open: boolean; missing: GateMissing[] }> {
    const en = await tx.placeLocalization.findUnique({
      where: { placeId_lang: { placeId, lang: 'en' } },
      select: { sourceContentHash: true, audioStatus: true, audioSourceContentHash: true },
    });
    const gate = ActivationGate.evaluate({ place, enLocalization: en });
    if (gate.open) {
      await tx.place.update({
        where: { id: placeId },
        data: {
          status: transition(PlaceStatus.PROCESSING, PlaceLifecycleEvent.GATE_OPENED),
          ...(place.publishedAt === null ? { publishedAt: new Date() } : {}),
        },
        select: { id: true },
      });
    }
    return gate;
  }

  private async lock(tx: CatalogTx, placeId: string): Promise<LockedPlace> {
    const [row] = await tx.$queryRaw<LockedPlace[]>`
      SELECT id, kind, owner_user_id AS "ownerUserId", public_code AS "publicCode",
             category_id AS "categoryId", area_id AS "areaId", name_vi AS "nameVi",
             description_vi AS "descriptionVi", content_hash AS "contentHash",
             address_vi AS "addressVi", trigger_radius_m AS "triggerRadiusM",
             narration_priority AS "narrationPriority", price_band AS "priceBand", phone,
             website_url AS "websiteUrl", status, inactive_reason AS "inactiveReason",
             activation_requested_at AS "activationRequestedAt", published_at AS "publishedAt",
             deleted_at AS "deletedAt",
             ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM places WHERE id = ${placeId}::uuid
      FOR UPDATE`;
    if (row === undefined) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    return row;
  }

  private async inactiveReason(
    tx: CatalogTx,
    placeId: string,
  ): Promise<PlaceInactiveReason | null> {
    const row = await tx.place.findUniqueOrThrow({
      where: { id: placeId },
      select: { inactiveReason: true },
    });
    return row.inactiveReason as PlaceInactiveReason | null;
  }

  /** An active category that may tag this kind of Place (rdm-spec C-2). */
  private async requireCategory(
    tx: CatalogTx,
    code: string,
    kind: PlaceKind,
  ): Promise<{ id: string }> {
    const category = await tx.category.findUnique({
      where: { code },
      select: { id: true, appliesTo: true, isActive: true },
    });
    if (!category?.isActive) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'CATEGORY' });
    }
    const appliesTo: string = category.appliesTo;
    if (appliesTo !== ANY_KIND && appliesTo !== String(kind)) {
      throw rpcError('CATEGORY_NOT_APPLICABLE');
    }
    return category;
  }

  /**
   * The category a write names for an existing Place: the Place's own is kept without a check —
   * `applies_to` and deactivation govern new choices only (rdm-spec C-2) — and a different one must
   * be active and applicable.
   */
  private async categoryForWrite(
    tx: CatalogTx,
    code: string,
    place: { readonly kind: PlaceKind; readonly categoryId: string },
  ): Promise<{ id: string }> {
    const kept = await tx.category.findFirst({
      where: { id: place.categoryId, code },
      select: { id: true },
    });
    return kept ?? this.requireCategory(tx, code, place.kind);
  }

  /**
   * Refuses to take a Place live in an inactive area (rdm-spec C-3); moving it into an active area
   * is the way out. Holds the areas lock shared, so no deactivation interleaves.
   */
  private async requireActiveArea(tx: CatalogTx, areaId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${AREAS_LOCK_KEY}))`;
    const area = await tx.area.findUniqueOrThrow({
      where: { id: areaId },
      select: { isActive: true },
    });
    if (!area.isActive) throw rpcError('AREA_INACTIVE');
  }

  /**
   * The active area whose boundary covers the point (rdm-spec C-1). Holds the areas lock shared
   * until the commit, so no boundary change or deactivation interleaves with the Place write
   * (rdm-spec C-3); Place writes stay concurrent with each other.
   */
  private async requireCoveringArea(
    tx: CatalogTx,
    location: GeoPoint,
  ): Promise<{ id: string; code: string }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${AREAS_LOCK_KEY}))`;
    // longitude first
    const [area] = await tx.$queryRaw<{ id: string; code: string }[]>`
      SELECT id, code FROM areas
      WHERE is_active
        AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography)
      ORDER BY sort_order, code
      LIMIT 1`;
    if (area === undefined) throw rpcError('LOCATION_OUTSIDE_AREAS');
    return area;
  }

  /**
   * Inserts the Place with a fresh public code, retrying a collision (rdm-spec C-1). The first
   * `sync_version` comes from the sequence in the same statement. Returns the code.
   */
  private async insertPlace(
    tx: CatalogTx,
    place: {
      id: string;
      kind: PlaceKind;
      categoryId: string;
      areaId: string;
      text: PlaceContentInput;
      contentHash: string;
      triggerRadiusM: number;
      narrationPriority: number;
      status: PlaceStatus;
      activationRequestedAt: Date | null;
      createdById: string;
      /** A Venue's owner; an Editorial Place has none. */
      ownerUserId?: string | null;
      /** A Venue's from its owner's plan (rdm-spec C-18); an Editorial Place always narrates. */
      autoNarrationEnabled?: boolean;
      /** A committed code: one attempt, no random fallback. */
      publicCode?: string;
    },
  ): Promise<string> {
    const { text } = place;
    const attempts = place.publicCode === undefined ? PUBLIC_CODE_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = place.publicCode ?? publicCodeFrom(randomBytes(PUBLIC_CODE_ENTROPY_BYTES));
      // longitude first
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO places (
          id, kind, owner_user_id, public_code, category_id, area_id, name_vi, description_vi, content_hash,
          location, address_vi, trigger_radius_m, narration_priority, auto_narration_enabled,
          discovery_boost, price_band, phone, website_url, status, activation_requested_at,
          sync_version, created_by_id, updated_at
        ) VALUES (
          ${place.id}::uuid, ${place.kind}, ${place.ownerUserId ?? null}::uuid, ${code},
          ${place.categoryId}::uuid, ${place.areaId}::uuid,
          ${text.nameVi}, ${text.descriptionVi}, ${place.contentHash},
          ST_SetSRID(ST_MakePoint(${text.location.lng}, ${text.location.lat}), 4326)::geography,
          ${text.addressVi ?? null}, ${place.triggerRadiusM}, ${place.narrationPriority},
          ${place.autoNarrationEnabled ?? true},
          0, ${text.priceBand ?? null}::smallint, ${text.phone ?? null}, ${text.websiteUrl ?? null},
          ${place.status}, ${place.activationRequestedAt}, nextval('catalog_sync_version_seq'),
          ${place.createdById}::uuid, clock_timestamp()
        )
        ON CONFLICT (public_code) DO NOTHING
        RETURNING id`;
      if (inserted.length === 1) return code;
    }
    throw rpcError('SHORT_CODE_COLLISION');
  }

  /** Turns confirmed uploads into photo rows; a file already on the Place is refused. */
  private async addPhotos(
    tx: CatalogTx,
    placeId: string,
    uploaderUserId: string,
    items: readonly {
      uploadId?: string;
      altTextVi?: string | null;
      sortOrder: number;
      index: number;
    }[],
    takenHashes: Set<string>,
    options: { readonly path?: string; readonly anyAge?: boolean } = {},
  ): Promise<void> {
    for (const item of items) {
      if (item.uploadId === undefined) continue;
      const upload = await this.uploads.consumeUpload(
        tx,
        item.uploadId,
        uploaderUserId,
        UploadPurpose.PLACE_PHOTO,
        { anyAge: options.anyAge === true },
      );
      // The unique (place, original) pair is the guarantee; this is the message.
      if (takenHashes.has(upload.sha256)) {
        throw issue(`${options.path ?? '/items'}/${item.index}`, 'custom');
      }
      takenHashes.add(upload.sha256);
      await tx.placePhoto.create({
        data: {
          placeId,
          sortOrder: item.sortOrder,
          variants: upload.variants,
          originalSha256: upload.sha256,
          altTextVi: item.altTextVi ?? null,
          uploadedById: uploaderUserId,
        },
        select: { id: true },
      });
    }
  }

  private async writeHours(
    tx: CatalogTx,
    placeId: string,
    rows: readonly OpeningHoursRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx.placeOpeningHours.createMany({
      data: rows.map((row) => ({
        placeId,
        weekday: row.weekday ?? null,
        specificDate:
          row.specificDate === undefined ? null : new Date(`${row.specificDate}T00:00:00Z`),
        opensAt: row.opensAt === undefined ? null : new Date(`1970-01-01T${row.opensAt}:00Z`),
        closesAt: row.closesAt === undefined ? null : new Date(`1970-01-01T${row.closesAt}:00Z`),
        isClosed: row.isClosed,
      })),
    });
  }

  private async requestNarration(
    tx: CatalogTx,
    placeId: string,
    kind: PlaceKind,
    ownerUserId: string | null,
    hash: string,
    trigger: SynthesisTrigger.APPROVAL | SynthesisTrigger.CONTENT_CHANGED,
    now: Date,
  ): Promise<void> {
    await this.outbox.add(tx, CATALOG_PLACE_CONTENT_CHANGED, {
      occurredAt: now.toISOString(),
      placeId,
      contentHash: hash,
      langs: [...(await this.languagesFor(tx, kind, ownerUserId))],
      trigger,
    });
  }

  /**
   * The languages a Place's text asks narration for (api-endpoints-plan §10): every launch language
   * for an Editorial Place; for a Venue, its owner's scope as catalog's projection holds it — never
   * a call to billing, so an edit works while billing is down (rdm-spec C-18).
   */
  private async languagesFor(
    db: CatalogTx,
    kind: PlaceKind,
    ownerUserId: string | null,
  ): Promise<readonly Language[]> {
    if (kind === PlaceKind.EDITORIAL || ownerUserId === null) return CONTENT_LANGUAGES;
    return scopeLanguages(await this.ownerEntitlements.scopeOf(db, ownerUserId));
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    placeId: string,
    now: Date,
    metadata?: AuditRecordPayload['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      placeAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        placeId,
        ...(metadata === undefined ? {} : { metadata }),
        origin: actor.origin,
        now,
      }),
    );
  }

  /** An audit row for catalog's own act: a consumer following billing's grants. */
  private async systemAudit(
    tx: CatalogTx,
    action: AuditAction,
    placeId: string,
    now: Date,
    metadata?: AuditRecordPayload['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      placeAuditRecord({
        actor: { type: AuditActorType.SYSTEM },
        action,
        placeId,
        ...(metadata === undefined ? {} : { metadata }),
        origin: { ip: null, userAgent: null },
        now,
      }),
    );
  }

  private async view(db: CatalogTx, placeId: string): Promise<catalogGrpc.AdminPlace> {
    const row = await db.place.findUniqueOrThrow({
      where: { id: placeId },
      select: ADMIN_PLACE_SELECT,
    });
    const [location] = await db.$queryRaw<GeoPoint[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM places WHERE id = ${placeId}::uuid`;
    return toAdminPlace(row, location!, this.mediaBase);
  }
}

/** A Venue the caller does not own, or a deleted one, is not found — never refused. */
function requireOwned(place: LockedPlace, ownerUserId: string): void {
  if (
    place.kind !== PlaceKind.VENUE ||
    place.ownerUserId !== ownerUserId ||
    place.deletedAt !== null
  ) {
    throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
  }
}

/** A payload's content fields, each stated (`null` clears). */
function contentOf(payload: PlaceSubmissionPayload): PlaceContentInput {
  return {
    nameVi: payload.nameVi,
    descriptionVi: payload.descriptionVi,
    categoryCode: payload.categoryCode,
    location: payload.location,
    addressVi: payload.addressVi,
    priceBand: payload.priceBand,
    phone: payload.phone,
    websiteUrl: payload.websiteUrl,
  };
}

/** Every object path a stored `PhotoVariants` names. */
function objectPathsOf(variants: Prisma.JsonValue): string[] {
  if (typeof variants !== 'object' || variants === null || Array.isArray(variants)) return [];
  return Object.values(variants).flatMap((variant) =>
    typeof variant === 'object' &&
    variant !== null &&
    !Array.isArray(variant) &&
    typeof variant.objectPath === 'string'
      ? [variant.objectPath]
      : [],
  );
}

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);

/** A print-ready sticker: the QR, then the code in a monospace font. */
async function stickerSvg(url: string, code: string): Promise<string> {
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  const inner = qr.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(qr);
  const size = Number(viewBox?.[1] ?? 29);
  const textHeight = Math.max(4, Math.round(size / 6));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + textHeight}" shape-rendering="crispEdges">`,
    `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner}</svg>`,
    `<rect x="0" y="${size}" width="${size}" height="${textHeight}" fill="#ffffff"/>`,
    `<text x="${size / 2}" y="${size + textHeight * 0.75}" font-family="ui-monospace, Menlo, monospace" font-size="${textHeight * 0.8}" text-anchor="middle" fill="#000000">${escapeXml(code)}</text>`,
    '</svg>',
  ].join('');
}
