import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zSha256Hex } from '../events/event-definition';
import { PlaceKind } from './enums';
import { ContentTier } from './localization';
import { zGeoPoint, zOpeningHoursRow, zPublicCode } from './schemas';

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
export const zMediaObject = z
  .object({
    url: z.url(),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
  })
  .strict();

/** A served photo variant. */
export const zPhotoView = zMediaObject
  .extend({ width: z.number().int().min(1), height: z.number().int().min(1) })
  .strict();
/** A served photo variant. */
export type PhotoView = z.output<typeof zPhotoView>;

/** A Place's narration, served only when it is ready for the text beside it (rdm-spec C-4). */
export const zPlaceAudio = zMediaObject.extend({ durationMs: z.number().int().min(1) }).strict();
/** A Place's served narration. */
export type PlaceAudio = z.output<typeof zPlaceAudio>;

/** The localized text of a record and where it came from (api-endpoints-plan §0.6). */
export const zPlaceLocalization = z
  .object({
    lang: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    contentTier: z.enum(ContentTier),
    stale: z.boolean(),
    audio: zPlaceAudio.nullable(),
  })
  .strict();
/** A Place's localized text. */
export type PlaceLocalization = z.output<typeof zPlaceLocalization>;

/**
 * What the offline engine holds per Place (api-endpoints-plan §2.1). `narrationPriority` and
 * `triggerRadiusM` are served, because the device decides narration; `discoveryBoost` never is.
 */
export const zPlaceSyncRecord = z
  .object({
    id: zUuidV7,
    kind: z.enum(PlaceKind),
    publicCode: zPublicCode,
    categoryCode: z.string().min(1),
    areaId: zUuidV7,
    location: zGeoPoint,
    triggerRadiusM: z.number().int(),
    narrationPriority: z.number().int(),
    autoNarrationEnabled: z.boolean(),
    localization: zPlaceLocalization,
    cardPhoto: zPhotoView.nullable(),
    priceBand: z.number().int().nullable(),
    openingHours: z.array(zOpeningHoursRow),
  })
  .strict();
/** One synced Place. */
export type PlaceSyncRecord = z.output<typeof zPlaceSyncRecord>;

/** One nearby result (api-endpoints-plan §2.1). `sponsored` is true exactly when a boost moved it. */
export const zPlaceSummary = z
  .object({
    id: zUuidV7,
    kind: z.enum(PlaceKind),
    publicCode: zPublicCode,
    categoryCode: z.string().min(1),
    location: zGeoPoint,
    name: z.string().min(1),
    lang: z.string().min(1),
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
