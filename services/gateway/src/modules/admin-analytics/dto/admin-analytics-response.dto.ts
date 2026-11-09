import { PlaceStatus } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().min(0);

/** Narrations by how they started: walking by (the geofence), tapping, scanning. */
const zByTrigger = z.object({ walkingBy: count, tapping: count, scanning: count }).strict();

/** Narrations by the audio ladder's step: ready on the phone, made on request, streamed, the phone's voice. */
const zByTier = z.object({ t1: count, t1_5: count, t2: count, t3: count }).strict();

const zFigures = {
  sessions: count,
  narrationsStarted: count,
  narrationsCompleted: count,
  byTrigger: zByTrigger,
  byTier: zByTier,
  packInstalls: count,
  /** Every scan (catalog's C-15), the same figure as the owners'. */
  qrScans: count,
};

/** `GET /admin/analytics/overview`. */
export const adminAnalyticsOverviewResponseSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    dataThrough: z.iso.date().nullable(),
    totals: z
      .object({
        ...zFigures,
        /** Finished ÷ started; null with nothing started. */
        completionRate: z.number().min(0).nullable(),
        /** The daily estimate's mean over the range — rotating ids, an upper bound. */
        activeDevicesEstimate: count,
      })
      .strict(),
    /** Every day of the range, a quiet one as zeros. */
    days: z.array(
      z.object({ day: z.iso.date(), ...zFigures, activeDevicesEstimate: count }).strict(),
    ),
    /** The language each narration played in, most first. */
    languages: z.array(
      z.object({ lang: z.string(), narrationsStarted: count, narrationsCompleted: count }).strict(),
    ),
  })
  .strict();

/** The overview. */
export class AdminAnalyticsOverviewResponseDto extends createZodDto(
  adminAnalyticsOverviewResponseSchema,
) {}

/** `GET /admin/analytics/places/top`: deleted Places dropped, the list still `limit` long. */
export const adminTopPlacesResponseSchema = z
  .object({
    metric: z.enum(['completed', 'started', 'listenMs']),
    dataThrough: z.iso.date().nullable(),
    places: z.array(
      z
        .object({
          placeId: z.uuid(),
          /** Its Vietnamese name, and its category's code: the row's line. */
          name: z.string(),
          categoryCode: z.string(),
          status: z.enum(PlaceStatus),
          narrationsStarted: count,
          narrationsCompleted: count,
          listenMs: count,
        })
        .strict(),
    ),
  })
  .strict();

/** The top Places. */
export class AdminTopPlacesResponseDto extends createZodDto(adminTopPlacesResponseSchema) {}

/** One heat square: its geohash-7 cell as a polygon, its estimate, the nearest live Place's name. */
const zHeatFeature = z
  .object({
    type: z.literal('Feature'),
    geometry: z
      .object({
        type: z.literal('Polygon'),
        coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
      })
      .strict(),
    properties: z
      .object({
        cell: z.string(),
        estimate: count,
        /** The ten busiest only; null when no live Place is within 300 m. */
        label: z.string().nullable().optional(),
      })
      .strict(),
  })
  .strict();

/** `GET /admin/analytics/heatmap`: suppressed cells (under 5 devices) are absent. */
export const adminHeatmapResponseSchema = z
  .object({
    areaId: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
    hours: z.string(),
    /** When the newest of these squares was counted; null with none. */
    computedThrough: z.iso.datetime().nullable(),
    /** Busiest first. */
    cells: z
      .object({ type: z.literal('FeatureCollection'), features: z.array(zHeatFeature) })
      .strict(),
  })
  .strict();

/** The heatmap. */
export class AdminHeatmapResponseDto extends createZodDto(adminHeatmapResponseSchema) {}

/** `GET /admin/analytics/runtime-activity`: an Area's hours, or every Area this hour so far. */
export const adminRuntimeResponseSchema = z
  .object({
    /** The finished hours, oldest first; with `areaId`. */
    hours: z.array(z.object({ hourStart: z.iso.datetime(), estimate: count }).strict()).optional(),
    /** This hour so far, per Area with any activity, busiest first; with `current=true`. */
    current: z
      .object({
        hourStart: z.iso.datetime(),
        areas: z.array(
          z
            .object({ areaId: z.uuid(), code: z.string(), name: z.string(), estimate: count })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

/** The runtime lane. */
export class AdminRuntimeResponseDto extends createZodDto(adminRuntimeResponseSchema) {}
