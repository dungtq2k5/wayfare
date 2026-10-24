import { zDatasetVersion, zGeoPoint, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A GeoJSON Polygon: rings of `[lng, lat]` positions. */
const zGeoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

/** An active area (rdm-spec C-3). Its name comes from the UI bundle, `area.<code>`. */
export const areaResponseSchema = z.object({
  id: zUuidV7,
  code: z.string(),
  center: zGeoPoint,
  defaultZoom: z.number().int(),
  boundary: zGeoJsonPolygon,
  /**
   * The published map pack — `null` without one. `style` and `styleDark` are its public style URLs,
   * which a web map draws with the pmtiles protocol; `styleDark` is `null` for a pack built before
   * the dark flavour.
   */
  mapPack: z
    .object({
      version: z.number().int(),
      bytes: z.number().int(),
      style: z.url(),
      styleDark: z.url().nullable(),
    })
    .nullable(),
  /** The content version a first sync reaches. */
  datasetVersion: zDatasetVersion,
});

/** One area, as `GET /areas` lists it. */
export class AreaResponseDto extends createZodDto(areaResponseSchema) {}
