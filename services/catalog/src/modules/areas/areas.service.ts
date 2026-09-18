import { Injectable } from '@nestjs/common';
import type { GeoPoint } from '@wayfare/contracts';
import { requireAccountContext } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

/** An area as it is written (rdm-spec C-3). `boundary` is a GeoJSON Polygon. */
export interface AreaInput {
  readonly id: string;
  readonly code: string;
  readonly nameVi: string;
  readonly boundary: {
    readonly type: 'Polygon';
    readonly coordinates: readonly (readonly (readonly number[])[])[];
  };
  readonly center: GeoPoint;
  readonly defaultZoom: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** What a write did, or why it was refused. */
export type AreaWrite =
  | { readonly outcome: 'created' | 'unchanged'; readonly id: string }
  | { readonly outcome: 'updated'; readonly id: string; readonly fields: readonly string[] }
  /** Another active area intersects it: areas may not overlap (rdm-spec C-3). */
  | { readonly outcome: 'overlaps'; readonly codes: readonly string[] }
  /** The new boundary would leave some of its live Places outside. */
  | { readonly outcome: 'uncovers'; readonly placeIds: readonly string[] };

interface StoredArea {
  id: string;
  name_vi: string;
  default_zoom: number;
  sort_order: number;
  is_active: boolean;
  same_boundary: boolean;
  same_center: boolean;
}

/**
 * The pilot areas (rdm-spec C-3): written by the development seed now, by the admin area route
 * later. One writer at a time, under an advisory lock; no two active areas may intersect, and a
 * boundary change must still cover every live Place of the area.
 */
@Injectable()
export class AreasService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertArea(context: RequestContext, input: AreaInput): Promise<AreaWrite> {
    requireAccountContext(context);
    const boundary = JSON.stringify(input.boundary);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog:areas'))`;
      if (input.isActive) {
        const overlapping = await tx.$queryRaw<{ code: string }[]>`
          SELECT code FROM areas
          WHERE is_active AND code <> ${input.code}
            AND ST_Intersects(boundary, ST_GeomFromGeoJSON(${boundary})::geography)
          ORDER BY code`;
        if (overlapping.length > 0) {
          return { outcome: 'overlaps', codes: overlapping.map((row) => row.code) };
        }
      }
      // longitude first
      const [stored] = await tx.$queryRaw<StoredArea[]>`
        SELECT id, name_vi, default_zoom, sort_order, is_active,
               ST_Equals(boundary::geometry, ST_GeomFromGeoJSON(${boundary})) AS same_boundary,
               ST_Equals(center::geometry, ST_SetSRID(ST_MakePoint(${input.center.lng}, ${input.center.lat}), 4326)) AS same_center
        FROM areas WHERE code = ${input.code}`;
      if (stored === undefined) {
        await tx.$executeRaw`
          INSERT INTO areas (id, code, name_vi, boundary, center, default_zoom, sort_order, is_active)
          VALUES (${input.id}::uuid, ${input.code}, ${input.nameVi},
                  ST_GeomFromGeoJSON(${boundary})::geography,
                  ST_SetSRID(ST_MakePoint(${input.center.lng}, ${input.center.lat}), 4326)::geography,
                  ${input.defaultZoom}, ${input.sortOrder}, ${input.isActive})`;
        return { outcome: 'created', id: input.id };
      }
      const fields = [
        ...(stored.name_vi === input.nameVi ? [] : ['nameVi']),
        ...(stored.same_boundary ? [] : ['boundary']),
        ...(stored.same_center ? [] : ['center']),
        ...(stored.default_zoom === input.defaultZoom ? [] : ['defaultZoom']),
        ...(stored.sort_order === input.sortOrder ? [] : ['sortOrder']),
        ...(stored.is_active === input.isActive ? [] : ['isActive']),
      ];
      if (fields.length === 0) return { outcome: 'unchanged', id: stored.id };
      if (!stored.same_boundary) {
        const outside = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM places
          WHERE area_id = ${stored.id}::uuid AND deleted_at IS NULL
            AND NOT ST_Covers(ST_GeomFromGeoJSON(${boundary})::geography, location)
          ORDER BY id`;
        if (outside.length > 0)
          return { outcome: 'uncovers', placeIds: outside.map((row) => row.id) };
      }
      await tx.$executeRaw`
        UPDATE areas
        SET name_vi = ${input.nameVi}, boundary = ST_GeomFromGeoJSON(${boundary})::geography,
            center = ST_SetSRID(ST_MakePoint(${input.center.lng}, ${input.center.lat}), 4326)::geography,
            default_zoom = ${input.defaultZoom}, sort_order = ${input.sortOrder},
            is_active = ${input.isActive}, updated_at = now()
        WHERE id = ${stored.id}::uuid`;
      return { outcome: 'updated', id: stored.id, fields };
    });
  }
}
