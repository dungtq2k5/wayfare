import { PlaceStatus } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().min(0);

/** How each story started, at `FULL` (walking by is the geofence). */
const zStartedBy = z.object({ walkingBy: count, tapping: count, scanning: count }).strict();

/**
 * A Venue's or the owner's figures over the range. `BASIC` has narrations, finished (and the
 * rate), average listening and QR scans; `FULL` adds stopped early, page opens and how each story
 * started. A field beyond the plan is absent, never 0 (api-endpoints-plan §7).
 */
export const ownerStatsFiguresSchema = z
  .object({
    narrationsStarted: count,
    narrationsCompleted: count,
    /** Finished ÷ started; null with nothing started. */
    completionRate: z.number().min(0).nullable(),
    /** Mean listening per narration heard, finished or not; null with none heard. */
    averageListenMs: count.nullable(),
    /** Every scan, whoever scanned: counted without consent, so its 0 is a real zero. */
    qrScans: count,
    narrationsAbandoned: count.optional(),
    opens: count.optional(),
    startedBy: zStartedBy.optional(),
  })
  .strict();

/** One business day of the series: narrations, and at `FULL` how they started. */
export const ownerStatsDaySchema = z
  .object({ day: z.iso.date(), narrationsStarted: count, startedBy: zStartedBy.optional() })
  .strict();

const zVenue = z
  .object({
    placeId: z.uuid(),
    name: z.string(),
    status: z.enum(PlaceStatus),
    /** Its category and Area, by code: the console words them as *My venues* does. */
    categoryCode: z.string(),
    areaCode: z.string(),
    /** Its last status change while it is `ACTIVE`, else null: "Live since" (not the first time live). */
    liveSince: z.iso.datetime().nullable(),
  })
  .strict();

const zCommon = {
  analyticsLevel: z.enum(['BASIC', 'FULL']),
  from: z.iso.date(),
  to: z.iso.date(),
  /** The last business day the nightly count completed; null before its first run. */
  dataThrough: z.iso.date().nullable(),
  totals: ownerStatsFiguresSchema,
  /** Every day of the range, a quiet one as zeros. */
  days: z.array(ownerStatsDaySchema),
};

/** `GET /owner/stats/places`: the owner's Venues, their totals, and the series across them. */
export const ownerStatsResponseSchema = z
  .object({
    ...zCommon,
    venues: z.array(zVenue.extend({ totals: ownerStatsFiguresSchema }).strict()),
  })
  .strict();

/** The owner's stats. */
export class OwnerStatsResponseDto extends createZodDto(ownerStatsResponseSchema) {}

/** `GET /owner/stats/places/:id`: one Venue's totals and its daily series. */
export const ownerVenueStatsResponseSchema = z.object({ ...zCommon, venue: zVenue }).strict();

/** One Venue's stats. */
export class OwnerVenueStatsResponseDto extends createZodDto(ownerVenueStatsResponseSchema) {}
