import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  PlaceStatus,
} from '@wayfare/contracts';
import type { AdminArea, AreaPlaceCounts, AreaPolygon, GeoPoint } from '@wayfare/contracts';
import { OutboxService, requireAccountContext, rpcError } from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { taxonomyAuditRecord } from '../places/domain/place-audit';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';
import { AREAS_LOCK_KEY, EXCLUDED_PLACE_IDS_SHOWN, LIVE_PLACE_STATUSES } from './domain/area-rules';

/** An area as it is written (rdm-spec C-3). `boundary` is a GeoJSON Polygon. */
export interface AreaInput {
  readonly id: string;
  readonly code: string;
  readonly nameVi: string;
  readonly boundary: AreaPolygon;
  readonly center: GeoPoint;
  readonly defaultZoom: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** An area edit: any field but the id and the code, which never change (rdm-spec C-3). */
export type AreaPatch = Partial<Omit<AreaInput, 'id' | 'code'>>;

/** Why a write was refused. */
export type AreaRefusal =
  /** Another active area intersects it: areas may not overlap (rdm-spec C-3). */
  | { readonly outcome: 'overlaps'; readonly codes: readonly string[] }
  /** The new boundary would leave Places of the area outside: all of them counted, some named. */
  | { readonly outcome: 'uncovers'; readonly count: number; readonly placeIds: readonly string[] }
  /** Deactivating it would strand `PROCESSING` or `ACTIVE` Places. */
  | { readonly outcome: 'has-live-places'; readonly count: number }
  /** An invalid shape, or a center outside the boundary, at the field the write named. */
  | {
      readonly outcome: 'invalid';
      readonly path: '/code' | '/boundary' | '/center';
      readonly code: string;
    };

/** What a write did, or why it was refused. */
export type AreaWrite =
  | { readonly outcome: 'created' | 'unchanged'; readonly id: string }
  | { readonly outcome: 'updated'; readonly id: string; readonly fields: readonly string[] }
  | AreaRefusal;

interface StoredArea {
  id: string;
  code: string;
  name_vi: string;
  boundary: string;
  lat: number;
  lng: number;
  default_zoom: number;
  sort_order: number;
  is_active: boolean;
}

/** Whether a write succeeded. */
export const isAreaRefusal = (write: AreaWrite): write is AreaRefusal =>
  write.outcome !== 'created' && write.outcome !== 'updated' && write.outcome !== 'unchanged';

/**
 * The pilot areas (rdm-spec C-3), written by the admin routes and the development seed. One writer
 * at a time, under the areas lock held exclusively — Place writes hold it shared — so no two
 * active areas intersect, a boundary always covers its Places, and no area with live Places is
 * deactivated. Every change is audited; an unchanged write writes nothing.
 */
@Injectable()
export class AreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Every area, active or not, with its Places by status; or the one `areaId` names. */
  async adminAreas(areaId?: string): Promise<AdminArea[]> {
    const only = areaId ?? null;
    // longitude first
    const rows = await this.prisma.$queryRaw<StoredArea[]>`
      SELECT id, code, name_vi, ST_AsGeoJSON(boundary, 15) AS boundary,
             ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng,
             default_zoom, sort_order, is_active
      FROM areas WHERE ${only}::uuid IS NULL OR id = ${only}::uuid
      ORDER BY sort_order, code`;
    const groups = await this.prisma.place.groupBy({
      by: ['areaId', 'status'],
      where: { deletedAt: null, ...(areaId === undefined ? {} : { areaId }) },
      _count: { _all: true },
    });
    return rows.map((row) => {
      const placeCounts: Record<PlaceStatus, number> = {
        [PlaceStatus.DRAFT]: 0,
        [PlaceStatus.PROCESSING]: 0,
        [PlaceStatus.ACTIVE]: 0,
        [PlaceStatus.INACTIVE]: 0,
      };
      for (const group of groups) {
        if (group.areaId === row.id) placeCounts[group.status as PlaceStatus] = group._count._all;
      }
      return {
        id: row.id,
        code: row.code,
        nameVi: row.name_vi,
        boundary: JSON.parse(row.boundary) as AdminArea['boundary'],
        center: { lat: row.lat, lng: row.lng },
        defaultZoom: row.default_zoom,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        placeCounts: placeCounts satisfies AreaPlaceCounts,
      };
    });
  }

  /** A new area; a taken code is refused at `/code` before anything else is checked. */
  async createArea(context: RequestContext, input: AreaInput): Promise<AreaWrite> {
    const actor = requireAccountContext(context);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const taken = await tx.area.findUnique({ where: { code: input.code }, select: { id: true } });
      if (taken !== null) return { outcome: 'invalid', path: '/code', code: 'taken' };
      return this.create(tx, actor, input);
    });
  }

  /** Changes the fields given. Throws `RESOURCE_NOT_FOUND` for an unknown id. */
  async updateArea(context: RequestContext, areaId: string, patch: AreaPatch): Promise<AreaWrite> {
    const actor = requireAccountContext(context);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const stored = await this.stored(tx, areaId);
      if (stored === undefined) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.AREA });
      }
      return this.update(tx, actor, stored, patch);
    });
  }

  /** The seed's write: creates the area by its code, or brings it to the input. */
  async upsertArea(context: RequestContext, input: AreaInput): Promise<AreaWrite> {
    const actor = requireAccountContext(context);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM areas WHERE code = ${input.code}`;
      const stored = row === undefined ? undefined : await this.stored(tx, row.id);
      if (stored === undefined) return this.create(tx, actor, input);
      const { id: _id, code: _code, ...patch } = input;
      return this.update(tx, actor, stored, patch);
    });
  }

  private async lock(tx: CatalogTx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AREAS_LOCK_KEY}))`;
  }

  private async create(tx: CatalogTx, actor: AccountContext, input: AreaInput): Promise<AreaWrite> {
    const boundary = JSON.stringify(input.boundary);
    const shape = await this.checkShape(tx, boundary, input.center, 'center');
    if (shape !== null) return shape;
    if (input.isActive) {
      const overlaps = await this.overlapping(tx, boundary, null);
      if (overlaps !== null) return overlaps;
    }
    await tx.$executeRaw`
      INSERT INTO areas (id, code, name_vi, boundary, center, default_zoom, sort_order, is_active)
      VALUES (${input.id}::uuid, ${input.code}, ${input.nameVi},
              ST_GeomFromGeoJSON(${boundary})::geography,
              ST_SetSRID(ST_MakePoint(${input.center.lng}, ${input.center.lat}), 4326)::geography,
              ${input.defaultZoom}, ${input.sortOrder}, ${input.isActive})`;
    await this.audit(tx, actor, AuditAction.AREA_CREATED, input.id, {
      after: {
        code: input.code,
        nameVi: input.nameVi,
        defaultZoom: input.defaultZoom,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
    return { outcome: 'created', id: input.id };
  }

  private async update(
    tx: CatalogTx,
    actor: AccountContext,
    stored: StoredArea,
    patch: AreaPatch,
  ): Promise<AreaWrite> {
    const sent = patch.boundary === undefined ? null : JSON.stringify(patch.boundary);
    const boundary = sent ?? stored.boundary;
    const center = patch.center ?? { lat: stored.lat, lng: stored.lng };
    const next = {
      nameVi: patch.nameVi ?? stored.name_vi,
      defaultZoom: patch.defaultZoom ?? stored.default_zoom,
      sortOrder: patch.sortOrder ?? stored.sort_order,
      isActive: patch.isActive ?? stored.is_active,
    };
    const [same] = await tx.$queryRaw<{ boundary: boolean; center: boolean }[]>`
      SELECT (${sent}::text IS NULL OR ST_Equals(boundary::geometry, ST_GeomFromGeoJSON(${sent}::text)))
               AS boundary,
             ST_Equals(center::geometry,
                       ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)) AS center
      FROM areas WHERE id = ${stored.id}::uuid`;
    const before = {
      nameVi: stored.name_vi,
      defaultZoom: stored.default_zoom,
      sortOrder: stored.sort_order,
      isActive: stored.is_active,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (field) => next[field] !== before[field],
    );
    const boundaryChanged = !same!.boundary;
    const centerChanged = !same!.center;
    const fields = [
      ...changed,
      ...(boundaryChanged ? ['boundary'] : []),
      ...(centerChanged ? ['center'] : []),
    ];
    if (fields.length === 0) return { outcome: 'unchanged', id: stored.id };

    if (boundaryChanged || centerChanged) {
      // The merged area is what must hold: a boundary-only edit may strand the stored center.
      const blame =
        patch.center !== undefined && patch.boundary === undefined ? 'center' : 'boundary';
      const shape = await this.checkShape(tx, boundary, center, blame);
      if (shape !== null) return shape;
    }
    if (next.isActive && (boundaryChanged || !stored.is_active)) {
      const overlaps = await this.overlapping(tx, boundary, stored.id);
      if (overlaps !== null) return overlaps;
    }
    if (boundaryChanged) {
      const outside = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM places
        WHERE area_id = ${stored.id}::uuid AND deleted_at IS NULL
          AND NOT ST_Covers(ST_GeomFromGeoJSON(${boundary})::geography, location)
        ORDER BY id`;
      if (outside.length > 0) {
        return {
          outcome: 'uncovers',
          count: outside.length,
          placeIds: outside.slice(0, EXCLUDED_PLACE_IDS_SHOWN).map((row) => row.id),
        };
      }
    }
    if (stored.is_active && !next.isActive) {
      const live = await tx.place.count({
        where: {
          areaId: stored.id,
          deletedAt: null,
          status: { in: LIVE_PLACE_STATUSES.map(String) },
        },
      });
      if (live > 0) return { outcome: 'has-live-places', count: live };
    }

    await tx.$executeRaw`
      UPDATE areas
      SET name_vi = ${next.nameVi},
          boundary = COALESCE(ST_GeomFromGeoJSON(${boundaryChanged ? sent : null}::text)::geography, boundary),
          center = ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography,
          default_zoom = ${next.defaultZoom}, sort_order = ${next.sortOrder},
          is_active = ${next.isActive}, updated_at = now()
      WHERE id = ${stored.id}::uuid`;
    await this.audit(tx, actor, AuditAction.AREA_UPDATED, stored.id, {
      before: Object.fromEntries(changed.map((field) => [field, before[field]])),
      after: {
        ...Object.fromEntries(changed.map((field) => [field, next[field]])),
        boundaryChanged,
        centerChanged,
      },
    });
    return { outcome: 'updated', id: stored.id, fields };
  }

  /** A valid shape (`ST_IsValid`), with the center inside it; the refusal names `blame`. */
  private async checkShape(
    tx: CatalogTx,
    boundary: string,
    center: GeoPoint,
    blame: 'boundary' | 'center',
  ): Promise<AreaRefusal | null> {
    const [shape] = await tx.$queryRaw<{ valid: boolean; covers: boolean | null }[]>`
      SELECT ST_IsValid(ST_GeomFromGeoJSON(${boundary})) AS valid,
             CASE WHEN ST_IsValid(ST_GeomFromGeoJSON(${boundary}))
               THEN ST_Covers(ST_GeomFromGeoJSON(${boundary})::geography,
                              ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography)
             END AS covers`;
    if (!shape!.valid) return { outcome: 'invalid', path: '/boundary', code: 'invalid_polygon' };
    if (shape!.covers !== true) {
      return { outcome: 'invalid', path: `/${blame}`, code: 'center_outside_boundary' };
    }
    return null;
  }

  /** The active areas, other than `exceptId`, that the boundary intersects. */
  private async overlapping(
    tx: CatalogTx,
    boundary: string,
    exceptId: string | null,
  ): Promise<AreaRefusal | null> {
    const rows = await tx.$queryRaw<{ code: string }[]>`
      SELECT code FROM areas
      WHERE is_active AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
        AND ST_Intersects(boundary, ST_GeomFromGeoJSON(${boundary})::geography)
      ORDER BY code`;
    return rows.length === 0 ? null : { outcome: 'overlaps', codes: rows.map((row) => row.code) };
  }

  private async stored(tx: CatalogTx, areaId: string): Promise<StoredArea | undefined> {
    // longitude first
    const [row] = await tx.$queryRaw<StoredArea[]>`
      SELECT id, code, name_vi, ST_AsGeoJSON(boundary, 15) AS boundary,
             ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng,
             default_zoom, sort_order, is_active
      FROM areas WHERE id = ${areaId}::uuid`;
    return row;
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    areaId: string,
    metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      taxonomyAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: AuditResourceType.AREA,
        resourceId: areaId,
        metadata,
        origin: actor.origin,
        now: new Date(),
      }),
    );
  }
}
