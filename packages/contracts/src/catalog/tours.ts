import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zServedLanguage } from '../common/languages';
import { CodeTargetType } from './enums';
import { MAX_DESCRIPTION_CHARS, MAX_TOUR_TITLE_LENGTH } from './limits';
import { ContentTier } from './localization';
import { objectOf, zGeoPoint, zPublicCode, zText } from './schemas';
import type { ObjectMode } from './schemas';
import { openEnum, photoViewSchema, zPhotoView } from './sync';

/** A tour's estimated time, in minutes (rdm-spec C-8). */
export const MIN_TOUR_MINUTES = 10;
export const MAX_TOUR_MINUTES = 600;

/** The most stops a tour holds: a walk, not a directory. */
export const MAX_TOUR_STOPS = 30;

/** Requesting activation needs this many stops (round 39's product decision). */
export const MIN_TOUR_STOPS_TO_ACTIVATE = 2;

const zTitle = zText(MAX_TOUR_TITLE_LENGTH, { singleLine: true });
const zDescription = zText(MAX_DESCRIPTION_CHARS);
const zMinutes = z.number().int().min(MIN_TOUR_MINUTES).max(MAX_TOUR_MINUTES);

/** The stop list: Place ids in order. Duplicates and Places outside the area are the server's. */
export const zTourStops = z.array(zUuidV7).max(MAX_TOUR_STOPS);

/** `POST /admin/tours` (api-endpoints-plan §3.6). */
export const zTourCreateInput = z
  .object({
    titleVi: zTitle,
    descriptionVi: zDescription,
    areaId: zUuidV7,
    estimatedMinutes: zMinutes,
    coverUploadId: zUuidV7.optional(),
    stops: zTourStops,
    requestActivation: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.requestActivation && input.stops.length < MIN_TOUR_STOPS_TO_ACTIVATE) {
      context.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: MIN_TOUR_STOPS_TO_ACTIVATE,
        inclusive: true,
        path: ['stops'],
        message: 'Requesting activation needs at least two stops',
      });
    }
  });
export type TourCreateInput = z.infer<typeof zTourCreateInput>;

/** `PATCH /admin/tours/:id`: an absent field is unchanged; `coverUploadId: null` removes the cover. */
export const zTourUpdateInput = z
  .object({
    titleVi: zTitle.optional(),
    descriptionVi: zDescription.optional(),
    estimatedMinutes: zMinutes.optional(),
    coverUploadId: zUuidV7.nullable().optional(),
  })
  .strict();
export type TourUpdateInput = z.infer<typeof zTourUpdateInput>;

/** `PUT /admin/tours/:id/stops`. */
export const zTourStopsInput = z.object({ stops: zTourStops }).strict();
export type TourStopsInput = z.infer<typeof zTourStopsInput>;

// ─── The tourist's tours (api-endpoints-plan §2.1, §2.2) ──────────────────────────────────────

/** A tour's text in the language served, through the one fallback chain. */
const tourTextSchema = <M extends ObjectMode>(mode: M) =>
  objectOf(mode, {
    lang: openEnum(mode, zServedLanguage),
    title: z.string().min(1),
    description: z.string(),
    contentTier: openEnum(mode, z.enum(ContentTier)),
    stale: z.boolean(),
  });
export const zTourText = tourTextSchema('strict');
export type TourText = z.output<typeof zTourText>;

/** A tour as a list shows it. `stopCount` counts the live stops a tourist sees. */
export const zTourSummary = z
  .object({
    id: zUuidV7,
    publicCode: zPublicCode,
    areaId: zUuidV7,
    areaCode: z.string().min(1),
    text: zTourText,
    cover: zPhotoView.nullable(),
    estimatedMinutes: z.number().int(),
    distanceM: z.number().int().min(0),
    stopCount: z.number().int().min(0),
  })
  .strict();
export type TourSummary = z.output<typeof zTourSummary>;

/** A live stop's Place: its name served and as written in Vietnamese. */
export const zTourStopPlace = z
  .object({
    id: zUuidV7,
    publicCode: zPublicCode,
    categoryCode: z.string().min(1),
    location: zGeoPoint,
    name: z.string().min(1),
    nameVi: z.string().min(1),
    cardPhoto: zPhotoView.nullable(),
  })
  .strict();

/**
 * One stop, at its original position (rdm-spec C-8: never renumbered): a gap when its Place isn't
 * live — `place: null`, its name unknown. `legM` is the straight line from the live stop before.
 */
export const zTourStopView = z
  .object({
    position: z.number().int().min(0),
    legM: z.number().int().min(0),
    place: zTourStopPlace.nullable(),
  })
  .strict();
export type TourStopView = z.output<typeof zTourStopView>;

/** `GET /tours/:id`, `GET /tours/by-code/:publicCode`. */
export const zTourDetail = zTourSummary
  .extend({
    coverVariants: z
      .object({ thumb: zPhotoView, card: zPhotoView, full: zPhotoView })
      .strict()
      .nullable(),
    stops: z.array(zTourStopView),
  })
  .strict();
export type TourDetail = z.output<typeof zTourDetail>;

/**
 * What the phone holds per tour (`GET /sync/tours`): its stops as Place ids by position — the phone
 * decides which are live from its own Places, by the same rule as the server's.
 */
const tourSyncRecordSchema = <M extends ObjectMode>(mode: M) =>
  objectOf(mode, {
    id: zUuidV7,
    publicCode: zPublicCode,
    areaId: zUuidV7,
    text: tourTextSchema(mode),
    cover: photoViewSchema(mode).nullable(),
    estimatedMinutes: z.number().int(),
    distanceM: z.number().int().min(0),
    stops: z.array(objectOf(mode, { position: z.number().int().min(0), placeId: zUuidV7 })),
  });
export const zTourSyncRecord = tourSyncRecordSchema('strict');
/** The record a client stores, unknown keys dropped (conventions §12.2). */
export const zTourSyncRecordStored = tourSyncRecordSchema('strip');
export type TourSyncRecord = z.output<typeof zTourSyncRecord>;
export type TourSyncRecordStored = z.output<typeof zTourSyncRecordStored>;

/** What a public code names (`GET /codes/:publicCode`). */
export const zCodeTarget = z
  .object({ type: z.enum(CodeTargetType), id: zUuidV7, publicCode: zPublicCode })
  .strict();
export type CodeTarget = z.output<typeof zCodeTarget>;
