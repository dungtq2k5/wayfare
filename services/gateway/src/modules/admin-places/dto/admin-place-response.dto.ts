import {
  AudioStatus,
  MenuCurrency,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  TranslationSource,
  zGeoPoint,
  zOpeningHoursRow,
  zPhotoView,
  zUuidV7,
} from '@wayfare/contracts';
import { ownerContactSchema } from '../../identity/dto/owner-contact.dto';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zInstant = z.iso.datetime({ offset: true });
const zSha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** What the activation gate still waits for (rdm-spec §1.6). */
const zGateMissing = z.enum(['en.text', 'en.audio', 'activation']);

/** A console table row (api-endpoints-plan §3.5). */
export const adminPlaceListItemResponseSchema = z.object({
  id: zUuidV7,
  kind: z.enum(PlaceKind),
  publicCode: z.string(),
  nameVi: z.string(),
  categoryCode: z.string(),
  areaId: zUuidV7,
  areaCode: z.string(),
  status: z.enum(PlaceStatus),
  inactiveReason: z.enum(PlaceInactiveReason).nullable(),
  ownerUserId: zUuidV7.nullable(),
  syncVersion: z.string(),
  cover: zPhotoView.nullable(),
  updatedAt: zInstant,
  deletedAt: zInstant.nullable(),
});

/** One row of `GET /admin/places`. */
export class AdminPlaceListItemResponseDto extends createZodDto(adminPlaceListItemResponseSchema) {}

/** A Place in full, for the console. */
export const adminPlaceResponseSchema = z.object({
  id: zUuidV7,
  kind: z.enum(PlaceKind),
  publicCode: z.string(),
  ownerUserId: zUuidV7.nullable(),
  categoryCode: z.string(),
  areaId: zUuidV7,
  areaCode: z.string(),
  nameVi: z.string(),
  descriptionVi: z.string(),
  contentHash: zSha256,
  location: zGeoPoint,
  addressVi: z.string().nullable(),
  triggerRadiusM: z.number().int(),
  narrationPriority: z.number().int(),
  autoNarrationEnabled: z.boolean(),
  discoveryBoost: z.number().int(),
  priceBand: z.number().int().nullable(),
  menuCurrency: z.enum(MenuCurrency),
  phone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  status: z.enum(PlaceStatus),
  inactiveReason: z.enum(PlaceInactiveReason).nullable(),
  activationRequestedAt: zInstant.nullable(),
  publishedAt: zInstant.nullable(),
  /** A string: the version is an int64. */
  syncVersion: z.string(),
  createdById: zUuidV7,
  createdAt: zInstant,
  updatedAt: zInstant,
  deletedAt: zInstant.nullable(),
  deletedById: zUuidV7.nullable(),
  /** Readiness and staleness per language. */
  localizations: z.array(
    z.object({
      lang: z.string(),
      textReady: z.boolean(),
      stale: z.boolean(),
      audioStatus: z.enum(AudioStatus),
      audioStale: z.boolean(),
      translationSource: z.enum(TranslationSource),
    }),
  ),
  photos: z.array(
    z.object({
      id: zUuidV7,
      sortOrder: z.number().int(),
      altTextVi: z.string().nullable(),
      thumb: zPhotoView,
      card: zPhotoView,
      full: zPhotoView,
      originalSha256: zSha256,
    }),
  ),
  menuItems: z.array(
    z.object({
      id: zUuidV7,
      nameVi: z.string(),
      descriptionVi: z.string().nullable(),
      priceMinor: z.number().int().nullable(),
      isAvailable: z.boolean(),
      sortOrder: z.number().int(),
    }),
  ),
  openingHours: z.array(zOpeningHoursRow),
  activationMissing: z.array(zGateMissing),
  /** Submission history joins when the Place page shows it. */
  submissions: z.array(z.never()),
});

/** A Place in full. */
export class AdminPlaceResponseDto extends createZodDto(adminPlaceResponseSchema) {}

/**
 * `GET /admin/places/:id`: the Place, and for a Venue its owner — named here because a content
 * moderator holds no `user.read` (api-endpoints-plan §3.5). `null` for an Editorial Place, and for
 * an owner identity cannot name (erased, or identity unreachable).
 */
export const adminPlaceDetailResponseSchema = adminPlaceResponseSchema.extend({
  owner: ownerContactSchema,
});

/** One Place, as a staff member's page reads it. */
export class AdminPlaceDetailResponseDto extends createZodDto(adminPlaceDetailResponseSchema) {}

/** `{ place }` — what the Place writes return. */
export const adminPlaceResultResponseSchema = z.object({ place: adminPlaceResponseSchema });

/** What the Place writes return under `data`. */
export class AdminPlaceResultResponseDto extends createZodDto(adminPlaceResultResponseSchema) {}

/** The gate's answer to an activation request — never a silent no-op. */
export const activationResultResponseSchema = z.object({
  status: z.enum(PlaceStatus),
  missing: z.array(zGateMissing),
});

/** What `POST /admin/places/:id/activate` returns under `data`. */
export class ActivationResultResponseDto extends createZodDto(activationResultResponseSchema) {}
