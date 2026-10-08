import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zServedLanguage } from '../common/languages';
import { zSha256Hex } from '../events/event-definition';
import { PlaceKind } from './enums';
import { ContentTier } from './localization';
import { geoPointSchema, objectOf, openingHoursRowSchema, zGeoPoint, zPublicCode } from './schemas';
import type { ObjectMode } from './schemas';

/**
 * A sync position (rdm-spec §1.7): an `int64` string on the wire (conventions §6.3), a JSON number
 * in REST once it is known to be a safe integer — a sequence will not pass 2⁵³.
 */
export const zDatasetVersion = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** An `int64` sync position from the wire, as a number; throws past the safe range. */
export function datasetVersionFromWire(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new RangeError(`Dataset version ${value} is not a safe integer`);
  }
  return parsed;
}

/** A served media object: its public URL and what a client verifies. */
const mediaObjectSchema = (mode: ObjectMode) =>
  objectOf(mode, {
    url: z.url(),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
  });
export const zMediaObject = mediaObjectSchema('strict');

/** A served photo variant. */
const photoViewSchema = (mode: ObjectMode) =>
  objectOf(mode, {
    url: z.url(),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  });
export const zPhotoView = photoViewSchema('strict');
/** A served photo variant. */
export type PhotoView = z.output<typeof zPhotoView>;

/** A Place's narration, served only when it is ready for the text beside it (rdm-spec C-4). */
const placeAudioSchema = (mode: ObjectMode) =>
  objectOf(mode, {
    url: z.url(),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
    durationMs: z.number().int().min(1),
  });
export const zPlaceAudio = placeAudioSchema('strict');
/** A Place's served narration. */
export type PlaceAudio = z.output<typeof zPlaceAudio>;

/**
 * An enum in the server's form, a plain string in the stored form: a value the server adds later
 * is as breaking to an installed app as a key it adds (conventions §12.2).
 */
const openEnum = <M extends ObjectMode, T extends z.ZodType>(mode: M, closed: T) =>
  (mode === 'strict' ? closed : z.string().min(1)) as M extends 'strict' ? T : z.ZodString;

/** The localized text of a record and where it came from (api-endpoints-plan §0.6). */
const placeLocalizationSchema = <M extends ObjectMode>(mode: M) =>
  objectOf(mode, {
    lang: openEnum(mode, zServedLanguage),
    name: z.string().min(1),
    description: z.string(),
    contentTier: openEnum(mode, z.enum(ContentTier)),
    stale: z.boolean(),
    audio: placeAudioSchema(mode).nullable(),
  });
export const zPlaceLocalization = placeLocalizationSchema('strict');
/** A Place's localized text. */
export type PlaceLocalization = z.output<typeof zPlaceLocalization>;

/**
 * What the offline engine holds per Place (api-endpoints-plan §2.1). `narrationPriority` and
 * `triggerRadiusM` are served, because the device decides narration; `discoveryBoost` never is.
 */
const placeSyncRecordSchema = <M extends ObjectMode>(mode: M) =>
  objectOf(mode, {
    id: zUuidV7,
    kind: openEnum(mode, z.enum(PlaceKind)),
    publicCode: zPublicCode,
    categoryCode: z.string().min(1),
    areaId: zUuidV7,
    location: geoPointSchema(mode),
    triggerRadiusM: z.number().int(),
    narrationPriority: z.number().int(),
    autoNarrationEnabled: z.boolean(),
    /** The Vietnamese address, shown as it is: a tourist shows it to a driver. */
    addressVi: z.string().nullable(),
    localization: placeLocalizationSchema(mode),
    cardPhoto: photoViewSchema(mode).nullable(),
    priceBand: z.number().int().nullable(),
    openingHours: z.array(openingHoursRowSchema(mode)),
  });

/** The record the server sends: unknown keys are a bug, at every level. */
export const zPlaceSyncRecord = placeSyncRecordSchema('strict');
/**
 * The record a client stores: the same shape with unknown keys dropped at every level, so a field
 * the server adds later never makes an installed app reject a sync (conventions §12.2).
 */
export const zPlaceSyncRecordStored = placeSyncRecordSchema('strip');
/** One synced Place. */
export type PlaceSyncRecord = z.output<typeof zPlaceSyncRecord>;
/** One synced Place as a client stores it: `lang`, `kind` and `contentTier` are open strings. */
export type PlaceSyncRecordStored = z.output<typeof zPlaceSyncRecordStored>;

/** One nearby result (api-endpoints-plan §2.1). `sponsored` is true exactly when a boost moved it. */
export const zPlaceSummary = z
  .object({
    id: zUuidV7,
    kind: z.enum(PlaceKind),
    publicCode: zPublicCode,
    categoryCode: z.string().min(1),
    location: zGeoPoint,
    name: z.string().min(1),
    lang: zServedLanguage,
    contentTier: z.enum(ContentTier),
    stale: z.boolean(),
    cardPhoto: zPhotoView.nullable(),
    priceBand: z.number().int().nullable(),
    distanceM: z.number().int().min(0),
    walkingEtaMinutes: z.number().int().min(0),
    sponsored: z.boolean(),
  })
  .strict();
/** One nearby result. */
export type PlaceSummary = z.output<typeof zPlaceSummary>;
