import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { CategoryAppliesTo, PlaceStatus } from './enums';
import { zCategoryCode, zGeoPoint } from './schemas';

/** The most vertices an area's boundary may have (rdm-spec C-3), the closing repeat not counted. */
export const MAX_AREA_VERTICES = 500;

/** An area's default map zoom (rdm-spec C-3, `areas_default_zoom_ck`). */
export const AREA_ZOOM_MIN = 10;
export const AREA_ZOOM_MAX = 18;

const zSortOrder = z.number().int().min(0).max(32_767);

/** An area code (rdm-spec C-3): lower-kebab, stable — it is in pack file names and storage keys. */
export const zAreaCode = z
  .string()
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** A category's sprite name in the map style (rdm-spec C-2). */
export const zCategoryIcon = z.string().regex(/^[a-z0-9_-]{1,64}$/);

/** A `[lng, lat]` position. */
const zPosition = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/**
 * An area's boundary (rdm-spec C-3): a GeoJSON Polygon of one closed ring, at most
 * `MAX_AREA_VERTICES` vertices. Its validity as a shape (`ST_IsValid`) and the center inside it are
 * checked by catalog, which holds the geometry engine.
 */
export const zAreaPolygon = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.tuple([
      z
        .array(zPosition)
        .min(4)
        .max(MAX_AREA_VERTICES + 1)
        .refine(
          (ring) => {
            const first = ring[0]!;
            const last = ring.at(-1)!;
            return first[0] === last[0] && first[1] === last[1];
          },
          { message: 'The ring must be closed' },
        ),
    ]),
  })
  .strict();
/** A validated area boundary. */
export type AreaPolygon = z.output<typeof zAreaPolygon>;

/** `POST /admin/categories` body (api-endpoints-plan §3.6). */
export const zCategoryCreateInput = z
  .object({
    code: zCategoryCode,
    appliesTo: z.enum(CategoryAppliesTo),
    icon: zCategoryIcon,
    sortOrder: zSortOrder,
  })
  .strict();
/** A validated new category. */
export type CategoryCreateInput = z.output<typeof zCategoryCreateInput>;

/** `PATCH /admin/categories/:id` body: never the code (rdm-spec C-2). */
export const zCategoryUpdateInput = z
  .object({
    appliesTo: z.enum(CategoryAppliesTo).optional(),
    icon: zCategoryIcon.optional(),
    sortOrder: zSortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
/** A validated category edit. */
export type CategoryUpdateInput = z.output<typeof zCategoryUpdateInput>;

const areaFields = {
  nameVi: z.string().trim().min(1).max(120),
  boundary: zAreaPolygon,
  center: zGeoPoint,
  defaultZoom: z.number().int().min(AREA_ZOOM_MIN).max(AREA_ZOOM_MAX),
  sortOrder: zSortOrder,
  isActive: z.boolean(),
};

/** `POST /admin/areas` body (api-endpoints-plan §3.6). */
export const zAreaCreateInput = z.object({ code: zAreaCode, ...areaFields }).strict();
/** A validated new area. */
export type AreaCreateInput = z.output<typeof zAreaCreateInput>;

/** `PATCH /admin/areas/:id` body: any field but the code (rdm-spec C-3). */
export const zAreaUpdateInput = z
  .object({
    nameVi: areaFields.nameVi.optional(),
    boundary: areaFields.boundary.optional(),
    center: areaFields.center.optional(),
    defaultZoom: areaFields.defaultZoom.optional(),
    sortOrder: areaFields.sortOrder.optional(),
    isActive: areaFields.isActive.optional(),
  })
  .strict();
/** A validated area edit. */
export type AreaUpdateInput = z.output<typeof zAreaUpdateInput>;

/** A category as the admin console lists it, with how many non-deleted Places use it. */
export const zAdminCategory = z
  .object({
    id: zUuidV7,
    code: z.string(),
    appliesTo: z.enum(CategoryAppliesTo),
    icon: z.string(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    placeCount: z.number().int().min(0),
  })
  .strict();
/** An admin category. */
export type AdminCategory = z.output<typeof zAdminCategory>;

/** Non-deleted Places per status. */
export const zAreaPlaceCounts = z
  .object({
    [PlaceStatus.DRAFT]: z.number().int().min(0),
    [PlaceStatus.PROCESSING]: z.number().int().min(0),
    [PlaceStatus.ACTIVE]: z.number().int().min(0),
    [PlaceStatus.INACTIVE]: z.number().int().min(0),
  })
  .strict();
/** An area's Place counts. */
export type AreaPlaceCounts = z.output<typeof zAreaPlaceCounts>;

/** An area as the admin console shows it, active or not, with its Place counts. */
export const zAdminArea = z
  .object({
    id: zUuidV7,
    code: z.string(),
    nameVi: z.string(),
    /** As stored: a GeoJSON Polygon of `[lng, lat]` positions. */
    boundary: z
      .object({
        type: z.literal('Polygon'),
        coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
      })
      .strict(),
    center: zGeoPoint,
    defaultZoom: z.number().int(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    placeCounts: zAreaPlaceCounts,
  })
  .strict();
/** An admin area. */
export type AdminArea = z.output<typeof zAdminArea>;
